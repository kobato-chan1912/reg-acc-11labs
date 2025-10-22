// get_verify_link.js
const axios = require('axios');
const cheerio = require('cheerio');

async function fetchMessages(email, refresh_token, client_id) {
  const url = 'https://tools.dongvanfb.net/api/get_messages_oauth2';
  const resp = await axios.post(url, { email, refresh_token, client_id }, { timeout: 20000 });
  return resp.data || {};
}

function extractVerifyFromHtml(html) {
  if (!html) return null;
  // load HTML and find <a href*="mode=verifyEmail">
  const $ = cheerio.load(html);
  const a = $('a[href*="mode=verifyEmail"]').first();
  if (a && a.attr('href')) return a.attr('href');

  // fallback: regex search inside html text
  const match = html.match(/https:\/\/elevenlabs\.io\/app\/action\?mode=verifyEmail[^"]+/);
  return match ? match[0] : null;
}

async function getVerifyLink(email, refresh_token, client_id, waitMs = 60_000, pollInterval = 3000) {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    try {
      const data = await fetchMessages(email, refresh_token, client_id);
      const messages = data.messages || [];
      for (const m of messages) {
        // tìm theo subject hoặc from
        const subj = (m.subject || '').toLowerCase();
        if (subj.includes('verify your email') || subj.includes('verify your email for elevenlabs') || (m.from || '').includes('elevenlabs')) {
          const html = m.message || m.message_html || m.body || '';
          const link = extractVerifyFromHtml(html);
          if (link) return link;
        }
      }
    } catch (err) {
      console.error('Lỗi fetch messages:', err.message || err.toString());
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error('Timeout: Không tìm thấy link verify trong thời gian chờ.');
}

// run (thay thông tin hoặc inject từ env)
(async () => {
  try {
    const email = process.argv[2] || 'hisakofausti7881@hotmail.com';
    const refresh_token = process.argv[3] || 'M.C525_BAY.0.U.-Cu23967uHPtvHEEP3cVYhwTAoCNU6tESK9!NNV41zcvId3bTa8zqsCZsIOKolP!N7oBGeeBXbcNavqZMaEWC5tBqsvDT18fBlQJ51XvrNe!R4SJEzKLIXAjjOXRmIad0Vq23elh8qfnm7wIYOpFFnBCvfIyAGADfNSdnFcnCvObx4hDSk1y9ET5yt1zH6tzh5TOVdp6V7xTkC9kH2SAgqTolDI07Qkswo5iMx!HcS!**MXH5YCz6so1pLtSe2JnvGd5ayf6WftAfiILbFkMTBXoRiQjZH9aadscacKmQDjB2S2aqgFA7X5pmURp3NiwvZlAMN9K0ibypeHK2LlSd!GYkRixoE83xTSzbKoQ0N16Hsfs5eEkwp4KomkydmoyzLMPP8ia2oHqP!xcwsazPPATQ7K5bofZpCBnt5ZTZIo5g0c5XvohnttLDC8hmfbQdBw$$';
    const client_id = process.argv[4] || '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
    console.log('Fetching verify link for', email);
    const link = await getVerifyLink(email, refresh_token, client_id, 90_000, 3000);
    console.log('Verify link found:\n', link);
  } catch (e) {
    console.error('Fail:', e.message);
    process.exit(1);
  }
})();
