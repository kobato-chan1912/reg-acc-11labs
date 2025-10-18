// file: register11labs.js
const puppeteer = require('puppeteer');
const axios = require('axios');
const pLimit = require('p-limit'); // Giữ nguyên phiên bản 3
const readline = require('readline');
require('dotenv').config();
const { faker } = require('@faker-js/faker');
const { TempMail } = require('tempmail.lol');

function generateStrongPassword(length = 12) {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const specials = "!@#$%^&*";
  const all = upper + lower + numbers + specials;

  let password = "";
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += specials[Math.floor(Math.random() * specials.length)];

  // Điền phần còn lại ngẫu nhiên
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // Trộn ngẫu nhiên
  return password.split('').sort(() => Math.random() - 0.5).join('');
}


async function createTempMail() {
    const tm = new TempMail();
    const inbox = await tm.createInbox();
    return { address: inbox.address, token: inbox.token, tm };
}

async function waitForVerifyLink(token, tm, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const emails = await tm.checkInbox(token);
        if (emails && emails.length > 0) {
            for (const mail of emails) {
                if (mail.subject && mail.subject.includes("Verify your email for ElevenLabs")) {
                    const body = mail.html || mail.body || "";
                    const match = body.match(/https:\/\/elevenlabs\.io\/app\/action\?mode=verifyEmail[^\s'"]+/);
                    if (match) {
                        return match[0];
                    }
                }
            }
        }
        await sleep(3000);
    }
    throw new Error('Không nhận được mail verify trong thời gian chờ.');
}


const {
    PROXY_API_URL,
    GMAIL_API_USERNAME,
    GMAIL_API_PASSWORD,
    GMAIL_API_ID,
    GPM_API_URL,
    SAVE_KEY_API_URL
} = process.env;

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 phút

// --- Hàm tiện ích ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min) * 1000;
const log = (threadId, message) => console.log(`[Tác vụ ${threadId}] ${message}`);
async function humanLikeClick(page, selector) {
    const btn = await page.waitForSelector(selector, { visible: true, timeout: 300000 });
    const box = await btn.boundingBox();

    if (!box) {
        throw new Error(`Không tìm thấy boundingBox cho selector: ${selector}`);
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await btn.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }));
    await page.mouse.move(x, y, { steps: 20 });
    await sleep(100 + Math.random() * 200);
    await page.mouse.down();
    await sleep(30 + Math.random() * 50);
    await page.mouse.up();
}

function randomWindowPosition() {
    const maxX = 1280 - 400;
    const maxY = 720 - 300;
    const x = Math.floor(Math.random() * maxX);
    const y = Math.floor(Math.random() * maxY);
    return `${x},${y}`;
}

function getFixedWindowPosition(threadId) {
    // Mỗi cửa sổ có kích thước tương đối cố định (ví dụ 400x300)
    // Giả định màn hình khoảng 1920x1080 — bạn có thể chỉnh cho phù hợp
    const positions = [
        "200,400",       // Luồng 1: góc trên bên trái
        "500,0",     // Luồng 2: bên phải 1 chút
        "1000,0",    // Luồng 3: trên bên phải
        "0,400",     // Luồng 4: hàng dưới
        "500,400",   // Luồng 5: giữa hàng dưới
        "1000,400",  // Luồng 6: phải hàng dưới
    ];

    // Nếu luồng vượt quá số vị trí định sẵn thì lặp lại (hoặc bạn có thể throw lỗi)
    const pos = positions[(threadId - 1) % positions.length];
    return pos;
}


// --- Lấy danh sách proxy từ URL ---
async function fetchProxiesList(proxiesUrl) {
    const res = await axios.get(proxiesUrl, { timeout: 15000 });
    const text = String(res.data || '');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const proxies = lines.map((line, idx) => {
        // format expected: host:port:user:pass:APIKEY
        const parts = line.split(':');
        if (parts.length < 5) {
            throw new Error(`Dòng proxy #${idx + 1} không hợp lệ: ${line}`);
        }
        // last part (APIKEY) có thể chứa ":" nếu lạ, nên join phần dư
        const host = parts[0];
        const port = parts[1];
        const user = parts[2];
        const pass = parts[3];
        const apiKey = parts.slice(4).join(':');
        return { host, port, user, pass, apiKey, rawLine: line };
    });
    return proxies;
}

// --- Hàm chính xử lý một luồng tự động ---
// bây giờ nhận proxyObj làm tham số
async function runAutomationProcess(taskId, proxyObj) {
    log(taskId, 'Bắt đầu...');
    let browser = null;
    let profileId = null;

    try {
        // --- 1. Log proxy đang dùng (ẩn bớt APIKEY khi log) ---
        const proxyLog = `${proxyObj.host}:${proxyObj.port}:${proxyObj.user}:**** (APIKEY hidden)`;
        log(taskId, `Sử dụng proxy: ${proxyLog}`);

        // --- 2. Gọi API đổi IP (proxy provider) trước khi mở profile ---
        if (proxyObj.apiKey) {
            try {
                const changeIpUrl = `https://proxyandanh.com/api/v1/proxy/change-ip?apiKey=${encodeURIComponent(proxyObj.apiKey)}`;
                log(taskId, `Gọi đổi IP: ${changeIpUrl}`);
                const changeResp = await axios.get(changeIpUrl, { timeout: 20000 });
                // Log toàn bộ response.data để debug (như yêu cầu)
                log(taskId, `Response đổi IP: ${JSON.stringify(changeResp.data)}`);
            } catch (err) {
                log(taskId, `WARNING: Gọi đổi IP thất bại: ${err.message}`);
                // Không dừng ngay — tùy bạn muốn strict thì throw ở đây

            }
        } else {
            log(taskId, 'Không có apiKey để gọi đổi IP — bỏ qua bước đổi IP.');
        }

        // --- 3. Tạo profile GPM (raw_proxy không chứa APIKEY) ---
        const rawProxyForGPM = `${proxyObj.host}:${proxyObj.port}:${proxyObj.user}:${proxyObj.pass}`;
        log(taskId, `Tạo profile GPM với raw_proxy (không có APIKEY): ${rawProxyForGPM}`);

        const createProfileResponse = await axios.post(`${GPM_API_URL}/profiles/create`, {
            raw_proxy: rawProxyForGPM,
            profile_name: `11Labs_Reg_${Date.now()}`
        }, { timeout: 30000 });

        if (!createProfileResponse.data || !createProfileResponse.data.success) {
            const msg = createProfileResponse.data ? createProfileResponse.data.message : 'No response body';
            throw new Error(`Tạo profile GPM thất bại: ${msg}`);
        }
        profileId = createProfileResponse.data.data.id;
        log(taskId, `Đã tạo profile ID: ${profileId}`);

        // --- 4. Start profile và connect puppeteer ---
        const win_pos = getFixedWindowPosition(taskId);
        log(taskId, `Khởi động profile GPM, win_pos=${win_pos} ...`);
        const startResponse = await axios.get(`${GPM_API_URL}/profiles/start/${profileId}?win_pos=${win_pos}`, { timeout: 30000 });

        if (!startResponse.data || !startResponse.data.success) {
            throw new Error(`Không thể mở profile: ${JSON.stringify(startResponse.data)}`);
        }

        const { remote_debugging_address } = startResponse.data.data;
        await sleep(5000);
        browser = await puppeteer.connect({
            browserURL: `http://${remote_debugging_address}`,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0];
        page.setDefaultTimeout(DEFAULT_TIMEOUT);
        log(taskId, 'Kết nối Puppeteer thành công.');

        // --- Các bước đăng nhập Google / register ElevenLabs giống cũ ---
        // --- 4. Đăng nhập Email ---

        const { address: email, token, tm } = await createTempMail();
        const password = generateStrongPassword(12);

        log(taskId, `Mail: ${email}`);
        log(taskId, `Password: ${password}`);


        // --- 5. Đăng ký tài khoản 11labs ---
        log(taskId, 'Bắt đầu đăng ký ElevenLabs...');
        await page.goto('https://elevenlabs.io/app/sign-up/', { waitUntil: 'networkidle2' });

        await sleep(5000)
        // await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', email, { delay: 80 });
        await page.type('input[type="password"]', password, { delay: 80 });
        // await page.waitForSelector('button[data-loading="false"]');
        await sleep(5000)
        await page.click('button[data-loading="false"]');
        await page.waitForFunction(() => document.querySelector('input[type="email"]').disabled, { timeout: 30000 });
        await sleep(10000);

        const verifyUrl = await waitForVerifyLink(token, tm);
        log(taskId, `Link verify: ${verifyUrl}`);

        await page.goto(verifyUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('button[data-loading="false"]');
        await sleep(3000)
        await page.click('button[data-loading="false"]');
        await sleep(3000);
        await page.focus('input[type="password"]');
        await sleep(4000);
        await page.keyboard.press('Enter');


        log(taskId, 'Chờ chuyển hướng về trang Onboarding...');
        await page.waitForFunction('window.location.href.includes("elevenlabs.io/app/onboarding")', { timeout: 60000 });
        log(taskId, 'Đăng ký thành công, đã chuyển đến trang Onboarding.');

        // --- 6. Thiết lập tài khoản ---
        log(taskId, 'Bắt đầu thiết lập tài khoản...');
        await page.goto('https://elevenlabs.io/app/onboarding', { waitUntil: 'networkidle2' });
        await sleep(5000)

        const nextButton1 = "#app-root > div.grow.h-full.w-full.flex.flex-col.justify-center.items-center.inter > div > div.h-full.w-full.flex.flex-col.justify-center.items-center > div > div > div > button";
        await page.waitForSelector(nextButton1); await page.click(nextButton1);

        log(taskId, 'Điền thông tin cá nhân...');
        await page.waitForSelector('#firstname');
        await sleep(2000);
        let fullName = `${faker.person.firstName()} ${faker.person.lastName()}`;
        await page.type('#firstname', fullName);
        await page.type('#bday-day', String(Math.floor(Math.random() * 27) + 1));
        await page.type('#bday-year', String(Math.floor(Math.random() * (1992 - 1980 + 1)) + 1980));
        await page.select('select[autocomplete="bday-month"]', String(Math.floor(Math.random() * 12)));

        await page.waitForSelector('form > div.hstack.gap-2.items-center > button'); await page.click('form > div.hstack.gap-2.items-center > button');
        await sleep(5000);

        const genericNextButton = "div > button";
        const skip1Btn = "#app-root > div.grow.h-full.w-full.flex.flex-col.justify-center.items-center.inter > div > div.h-full.w-full.flex.flex-col.justify-center.items-center > div > div:nth-child(3) > div > div > div:nth-child(2) > button"
        await page.waitForSelector(skip1Btn); await page.click(skip1Btn);
        await sleep(5000);

        // chia 2 man hinh

        const ctnBtn = "#app-root > div.grow.h-full.w-full.flex.flex-col.justify-center.items-center.inter > div > div.h-full.w-full.flex.flex-col.justify-center.items-center > div > div > div > div.hstack.gap-2.items-center > button"
        await page.waitForSelector(ctnBtn); await page.click(ctnBtn);
        await sleep(5000);




        const skip2Btn = "#app-root > div.grow.h-full.w-full.flex.flex-col.justify-center.items-center.inter > div > div.h-full.w-full.flex.flex-col.justify-center.items-center > div > div:nth-child(3) > div > div > div:nth-child(2) > button"
        await page.waitForSelector(skip2Btn); await page.click(skip2Btn);
        await sleep(5000);

        // What would you like to do with ElevenLabs?


        const skip3Btn = "#app-root > div.grow.h-full.w-full.flex.flex-col.justify-center.items-center.inter > div > div.h-full.w-full.flex.flex-col.justify-center.items-center > div > div:nth-child(3) > div > div > div > div.hstack.gap-2.items-center > button"
        await page.waitForSelector(skip3Btn); await page.click(skip3Btn);
        await sleep(5000);

        // Do more with ElevenLabs


        const finishOnboardingBtn = "div.hstack > button:nth-child(1)";
        await page.waitForSelector(finishOnboardingBtn); await page.click(finishOnboardingBtn);

        await page.waitForSelector('textarea');
        log(taskId, 'Thiết lập tài khoản hoàn tất. Chờ ...');
        await sleep(10000);

        // --- 7. Lấy API Key ---
        log(taskId, 'Bắt đầu lấy API Key...');
        await page.goto('https://elevenlabs.io/app/developers/api-keys', { waitUntil: 'networkidle2' });

        await sleep(2000)
        const createButtons = await page.$$('button[data-loading=false]');
        await createButtons[0].click();

        await page.waitForSelector("div[role=dialog] button.peer");
        await sleep(2000);
        await page.click("div[role=dialog] button.peer");

        await sleep(5000)

        const reloadCreateButtons = await page.$$('button[data-loading=false]');
        await reloadCreateButtons[reloadCreateButtons.length - 1].click();

        const apiKeyInputSelector = "div[role=dialog] input";
        await sleep(3000)
        await page.waitForSelector(apiKeyInputSelector);
        const apiKey = await page.$eval(apiKeyInputSelector, el => el.value);

        if (!apiKey) throw new Error('Không thể lấy được API Key.');

        log(taskId, `Lấy API Key thành công: ${apiKey.substring(0, 8)}...`);
        await axios.post("https://11labs.toolsetting.cfd/add_key.php", {
            api_key: apiKey,
        });

        log(taskId, 'Đã lưu API Key: ' + apiKey);

        log(taskId, 'HOÀN THÀNH TÁC VỤ THÀNH CÔNG!');
        return true; // Trả về true khi thành công

    } catch (error) {
        console.log(error)
        console.error(`[Tác vụ ${taskId}] GẶP LỖI: ${error.message}`);
        return false;
    } finally {
        if (browser) {
            log(taskId, 'Đang đóng kết nối trình duyệt...');
            try { await browser.disconnect(); } catch (e) { /* ignore */ }
        }
        if (profileId) {
            try {
                log(taskId, 'Đang đóng và xóa profile...');
                await axios.get(`${GPM_API_URL}/profiles/close/${profileId}`);
                await sleep(2000);
                await axios.delete(`${GPM_API_URL}/profiles/delete/${profileId}?mode=2`);
                log(taskId, 'Dọn dẹp profile thành công.');
            } catch (cleanupError) {
                console.error(`[Tác vụ ${taskId}] Lỗi khi dọn dẹp profile: ${cleanupError.message}`);
            }
        }
        const delay = randomDelay(10, 60);
        log(taskId, `Tác vụ kết thúc. Nghỉ ${delay / 1000} giây.`);
        await sleep(delay);
    }
}

// --- Hàm khởi động chương trình ---
async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (query) => new Promise(resolve => rl.question(query, resolve));

    const concurrencyInput = await question('Nhập số luồng muốn chạy đồng thời: ');
    const numThreads = parseInt(concurrencyInput, 10);
    if (isNaN(numThreads) || numThreads <= 0) {
        console.log('Lỗi: Số luồng phải là một số nguyên dương.');
        rl.close();
        return;
    }

    const totalAccountsInput = await question('Nhập tổng số tài khoản muốn đăng ký thành công: ');
    const totalAccounts = parseInt(totalAccountsInput, 10);
    if (isNaN(totalAccounts) || totalAccounts <= 0) {
        console.log('Lỗi: Tổng số tài khoản phải là một số nguyên dương.');
        rl.close();
        return;
    }

    rl.close();

    // --- Lấy danh sách proxy từ URL ---
    const proxiesUrl = 'https://11labs.toolsetting.cfd/proxies.txt';
    console.log(`Đang tải danh sách proxy từ: ${proxiesUrl} ...`);
    let proxies = [];
    try {
        proxies = await fetchProxiesList(proxiesUrl);
    } catch (err) {
        console.error('Lỗi khi tải/parsing proxies:', err.message);
        return;
    }

    console.log(`Tổng proxy lấy được: ${proxies.length}`);
    if (numThreads > proxies.length) {
        console.error(`ERROR: Số luồng (${numThreads}) lớn hơn số proxy có sẵn (${proxies.length}). Không thể chạy.`);
        return;
    }

    console.log(`\n▶️ Bắt đầu chạy với ${numThreads} luồng để đăng ký tổng cộng ${totalAccounts} tài khoản...`);

    // Dùng stack làm pool proxy (pop để cấp, push để trả lại)
    const availableProxies = proxies.slice(); // clone

    const limit = pLimit(numThreads);
    let successfulRegs = 0;
    let attemptCount = 0;

    const jobPromises = Array.from({ length: totalAccounts }).map(() =>
        limit(async function registerAttempt() {
            attemptCount++;
            const currentAttemptId = attemptCount;

            // LẤY proxy từ pool (synchronous - JS single thread nên an toàn)
            if (availableProxies.length === 0) {
                // (không xảy ra do pLimit + kiểm tra numThreads <= proxies.length) nhưng phòng hờ:
                throw new Error('No available proxy to assign for this task.');
            }
            const proxyObj = availableProxies.pop();
            log(currentAttemptId, `Được cấp proxy: ${proxyObj.host}:${proxyObj.port} (pool còn ${availableProxies.length})`);

            try {
                const success = await runAutomationProcess(currentAttemptId, proxyObj);

                if (success) {
                    successfulRegs++;
                    console.log(`\n✅ TIẾN ĐỘ: Đã đăng ký thành công ${successfulRegs} / ${totalAccounts} tài khoản.\n`);
                    return true;
                } else {
                    console.log(`\n❌ THẤT BẠI: Lần thử #${currentAttemptId} thất bại. Sẽ thử lại với tác vụ mới.\n`);
                    // retry: trả proxy về pool trước khi gọi lại
                    availableProxies.push(proxyObj);
                    return registerAttempt(); // will re-acquire a proxy when it runs next
                }
            } finally {
                // Sau khi tác vụ hoàn thành (thành công/ thất bại), trả proxy về pool để luồng khác dùng tiếp
                if (!availableProxies.includes(proxyObj)) {
                    availableProxies.push(proxyObj);
                }
                log(currentAttemptId, `Trả lại proxy vào pool. Pool hiện có ${availableProxies.length} proxy.`);
            }
        })
    );

    // Chờ tất cả các công việc hoàn thành
    await Promise.all(jobPromises);

    console.log(`\n🎉 HOÀN TẤT! Đã đăng ký thành công ${totalAccounts} tài khoản.`);
}

main().catch(err => {
    console.error('Lỗi không mong muốn:', err);
    process.exit(1);
});
