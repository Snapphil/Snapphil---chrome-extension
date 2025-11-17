## HTML Resume Renderer Cheat Sheet

1. **Collect Inputs**
   - Assemble a JSON payload with all resume data (name, contact info, section lists, bullets, etc.).
   - Call a helper like `buildResumeHtml(data)` that mirrors the `RESUME_HTML` template from `scripts/renderResumeHtml.js` but swaps in the payload values.

2. **Render Pipeline**
   ```ts
   const html = buildResumeHtml(resumeData);
   const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
   const page = await browser.newPage();
   await page.setContent(html, { waitUntil: 'networkidle0' });
   const pdfBuffer = await page.pdf({
     format: 'Letter',
     printBackground: true,
     margin: { top: '0.2in', bottom: '0.25in', left: '0.25in', right: '0.25in' },
   });
   await browser.close();

   const docxBuffer = await htmlToDocx(html, null, { table: { row: { cantSplit: true } } });
   ```
   - Runs in the Node sidecar (not inside the extension service-worker context).
   - Returns both PDF and DOCX byte buffers.

3. **Delivering Files**
   - Save to `tmp/resume-html/*.pdf|docx`, or emit the buffers back to the extension so it can trigger `chrome.downloads.download` / upload flows.
   - Surface any rendering error to the agent (Puppeteer launch failures, template issues).

4. **Customization Knobs**
   - All layout tweaks happen in the `<style>` block (body padding, fonts, spacing). Current defaults: 24px×30px padding, tight section gaps, minimal bullet spacing.
   - Support multiple themes by creating additional HTML template builders; switch based on user preference.

5. **Gotchas**
   - Puppeteer requires a sandbox exception when running in certain environments (`--no-sandbox` flag already included).
   - Ensure fonts you reference exist on target machines or ship web-safe fallbacks.
   - Keep the HTML snippet free of remote assets (images/fonts) unless you inline/base64 them, so rendering doesn’t depend on network access.

