const puppeteer = require('puppeteer');
const axios = require('axios');
const pLimit = require('p-limit'); // Giữ nguyên phiên bản 3
const readline = require('readline');
require('dotenv').config();
const {faker} = require('@faker-js/faker');
const { timeout } = require('puppeteer-core');
// --- Lấy cấu hình từ file .env ---
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
    // Đợi element hiển thị tối đa 5 phút
    const btn = await page.waitForSelector(selector, { visible: true, timeout: 300000 });
    const box = await btn.boundingBox();

    if (!box) {
        throw new Error(`Không tìm thấy boundingBox cho selector: ${selector}`);
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Scroll element vào giữa viewport
    await btn.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }));

    // Di chuột tới vị trí của button với nhiều bước (cho mượt)
    await page.mouse.move(x, y, { steps: 20 });

    // Hover 100–300ms giống người dùng dừng lại trước khi click
    await sleep(100 + Math.random() * 200);

    // Giả lập click: mouse down → giữ 30–80ms → mouse up
    await page.mouse.down();
    await sleep(30 + Math.random() * 50);
    await page.mouse.up();
}


// Hàm chính xử lý một luồng tự động
// Trả về true nếu thành công, false nếu thất bại
async function runAutomationProcess(taskId) {
    log(taskId, 'Bắt đầu...');
    let browser = null;
    let profileId = null;

    try {
        // --- 2. Lấy dữ liệu và tạo profile GPM ---
        log(taskId, 'Đang lấy Proxy...');
        const proxyResponse = await axios.get("https://11labs.toolsetting.cfd/proxy.php");
        const proxy = proxyResponse.data.trim();
        log(taskId, `Đã lấy Proxy: ${proxy.split('@')[0]}...`);

        log(taskId, 'Đang tạo profile GPM...');
        const createProfileResponse = await axios.post(`${GPM_API_URL}/profiles/create`, {
            raw_proxy: proxy,
            profile_name: `11Labs_Reg_${Date.now()}`
        });

        if (!createProfileResponse.data.success) {
            throw new Error(`Tạo profile GPM thất bại: ${createProfileResponse.data.message}`);
        }
        profileId = createProfileResponse.data.data.id;
        log(taskId, `Đã tạo profile ID: ${profileId}`);

        // --- 3. Kết nối với profile GPM ---
        log(taskId, 'Đang khởi động profile và kết nối Puppeteer...');
        const startResponse = await axios.get(`${GPM_API_URL}/profiles/start/${profileId}`);
        if (!startResponse.data.success) {
            throw new Error(`Không thể mở profile: ${startResponse.data.message}`);
        }

        const { remote_debugging_address } = startResponse.data.data;
        await sleep(5000); // Chờ GPM khởi động hoàn tất
        browser = await puppeteer.connect({
            browserURL: `http://${remote_debugging_address}`,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0];
        page.setDefaultTimeout(DEFAULT_TIMEOUT);
        log(taskId, 'Kết nối Puppeteer thành công.');

        // --- 4. Đăng nhập Google ---
        log(taskId, 'Bắt đầu quá trình đăng nhập Google...');
        log(taskId, 'Đang lấy tài khoản Gmail...');
        const gmailApiUrl = `https://mail3979.com/api/BResource.php?username=${GMAIL_API_USERNAME}&password=${GMAIL_API_PASSWORD}&id=${GMAIL_API_ID}&amount=1`;
        const gmailResponse = await axios.get(gmailApiUrl);
        if (gmailResponse.data.status !== 'success' || !gmailResponse.data.data.lists[0]) {
            throw new Error('Lấy tài khoản Gmail thất bại.');
        }
        const [email, password] = gmailResponse.data.data.lists[0].account.split('|');
        log(taskId, `Đã lấy Gmail: ${email}`);

        await page.goto('https://accounts.google.com', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#identifierId');
        await sleep(3000)
        await page.type('#identifierId', email, { delay: 100 });
        await page.keyboard.press('Enter');

        await page.waitForSelector('input[type="password"]', { visible: true });
        await sleep(2000);
        await page.type('input[type="password"]', password, { delay: 100 });
        await page.keyboard.press('Enter');

        try {
            log(taskId, "Chờ nút 'Confirm' trong 15 giây...");
            await page.waitForSelector('#confirm', { timeout: 15000 });
            await page.click('#confirm');
            log(taskId, "Đã click nút 'Confirm'.");
        } catch (error) {
            log(taskId, "Không tìm thấy nút 'Confirm', tiếp tục.");
        }

        try {
            log(taskId, "Chờ liên kết tùy chọn trong 15 giây...");
            const optionalLinkSelector = '#yDmH0d > div.YS0oNc.xAuNcb > main > c-wiz.yip5uc.SSPGKf > div > div.Z6C2jc > a';
            await page.waitForSelector(optionalLinkSelector, { timeout: 15000 });
            await page.click(optionalLinkSelector);
            log(taskId, "Đã click liên kết tùy chọn.");
        } catch (error) {
            log(taskId, "Không tìm thấy liên kết tùy chọn, tiếp tục.");
        }

        await page.waitForSelector('.YPzqGd', { visible: true });
        log(taskId, 'Đăng nhập Google thành công.');
        await sleep(3000);

        // --- 5. Đăng ký tài khoản 11labs ---
        log(taskId, 'Bắt đầu đăng ký ElevenLabs...');
        await page.goto('https://elevenlabs.io/app/sign-in', { waitUntil: 'networkidle2' });

        log(taskId, 'Chờ 10 giây...');
        await sleep(10000);

        const googleSignInButtonSelector = "#app-root div:nth-child(1) > button";
        await page.waitForSelector(googleSignInButtonSelector);


        const [popup] = await Promise.all([
            new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
            // page.click(googleSignInButtonSelector)
            humanLikeClick(page, googleSignInButtonSelector)
        ]);
        if (popup) await popup.waitForNavigation({ waitUntil: 'networkidle0', timeout: 300000 });
        await sleep(5000)
        log(taskId, 'Cửa sổ đăng nhập Google đã hiện ra.');
        await popup.setViewport({ width: 1280, height: 800 });


        const firstAccountSelector = 'li.aZvCDf.oqdnae';
        await popup.waitForSelector(firstAccountSelector, { visible: true });
        await sleep(2000);
        // await popup.click(firstAccountSelector);
        await humanLikeClick(popup, firstAccountSelector)
        log(taskId, 'Đã chọn tài khoản Google.');

        const continueButtonSelector = '#yDmH0d > c-wiz > main > div.JYXaTc.F8PBrb > div > div > div:nth-child(2) > div > div > button';
        await popup.waitForSelector(continueButtonSelector, { visible: true });
        await sleep(5000);
        // await popup.click(continueButtonSelector);
        await humanLikeClick(popup, continueButtonSelector)
        log(taskId, 'Đã nhấn Tiếp tục.');


        log(taskId, 'Chờ chuyển hướng về trang Onboarding...');
        await page.waitForFunction(
            'window.location.href.includes("elevenlabs.io/app/onboarding")', { timeout: 60000 }
        );
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


        await createButtons[createButtons.length - 1].click();

        const apiKeyInputSelector = "div[role=dialog] input";
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
        console.error(`[Tác vụ ${taskId}] GẶP LỖI: ${error.message}`);
        return false; // Trả về false khi thất bại
    } finally {
        if (browser) {
            log(taskId, 'Đang đóng kết nối trình duyệt...');
            await browser.disconnect();
        }
        if (profileId) {
            try {
                log(taskId, 'Đang đóng và xóa profile...');
                await axios.get(`${GPM_API_URL}/profiles/close/${profileId}`);
                await sleep(2000);
                await axios.delete(`${GPM_API_URL}/profiles/delete/${profileId}`);
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
    console.log(`\n▶️ Bắt đầu chạy với ${numThreads} luồng để đăng ký tổng cộng ${totalAccounts} tài khoản...`);

    const limit = pLimit(numThreads);
    let successfulRegs = 0;
    let attemptCount = 0;

    // Tạo một mảng "công việc". Mỗi công việc sẽ chạy cho đến khi đăng ký thành công 1 tài khoản.
    const jobPromises = Array.from({ length: totalAccounts }).map(() =>
        limit(async function registerAttempt() {
            attemptCount++;
            const currentAttemptId = attemptCount;
            const success = await runAutomationProcess(currentAttemptId);

            if (success) {
                successfulRegs++;
                console.log(`\n✅ TIẾN ĐỘ: Đã đăng ký thành công ${successfulRegs} / ${totalAccounts} tài khoản.\n`);
                return true; // Hoàn thành công việc này
            } else {
                console.log(`\n❌ THẤT BẠI: Lần thử #${currentAttemptId} thất bại. Sẽ thử lại với tác vụ mới.\n`);
                return registerAttempt(); // Tự động thử lại công việc này
            }
        })
    );

    // Chờ tất cả các công việc hoàn thành
    await Promise.all(jobPromises);

    console.log(`\n🎉 HOÀN TẤT! Đã đăng ký thành công ${totalAccounts} tài khoản.`);
}

main();