const path = require('path');
const fs = require('fs/promises');
const puppeteer = require('puppeteer');
const htmlToDocx = require('html-to-docx');

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: "Cormorant Garamond", "Times New Roman", serif;
    margin: 0;
    padding: 24px 30px;
    color: #111;
    line-height: 1.35;
  }
  h1, h2 {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 4px;
  }
  h1 {
    font-size: 30px;
    text-align: center;
    margin-bottom: 6px;
  }
  h2 {
    font-size: 17px;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
    margin-top: 18px;
  }
  p { margin: 2px 0; }
  ul { margin: 4px 0 0 18px; padding-left: 0; }
  li { font-size: 13px; margin-bottom: 4px; }
  .section { margin-bottom: 12px; }
  .subheading {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    margin-top: 6px;
  }
  .subheading span {
    font-style: italic;
    font-weight: normal;
    font-size: 13px;
  }
`;

const RESUME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tailored Resume</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Sample Candidate</h1>
  <p style="text-align:center;font-size:13px;">contact@example.com • 555-555-5555 • linkedin.com/sample</p>
  <div class="section">
    <h2>Experience</h2>
    <div class="subheading">
      <div>Sample Company</div>
      <span>2023 – Present</span>
    </div>
    <ul>
      <li>Describe your impact here.</li>
      <li>Second bullet for accomplishments.</li>
    </ul>
  </div>
</body>
</html>`;

function buildResumeHtml(data = {}) {
  if (!data || typeof data === 'string') {
    return typeof data === 'string' ? data : RESUME_HTML;
  }
  if (data.fullHtml) return data.fullHtml;
  if (data.html) return data.html;
  if (data.htmlResume) return data.htmlResume;
  if (data.body) {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${data.title || 'Tailored Resume'}</title>
        <style>${data.styles || ''}</style>
      </head>
      <body>${data.body}</body>
      </html>`;
  }
  if (Array.isArray(data.sections)) {
    const sections = data.sections.map(section => {
      if (!section) return '';
      const heading = section.heading ? `<h2>${section.heading}</h2>` : '';
      const body = section.html
        ? section.html
        : Array.isArray(section.items)
          ? `<ul>${section.items.map(item => `<li>${item}</li>`).join('')}</ul>`
          : '';
      return `<div class="section">${heading}${body}</div>`;
    }).join('');

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${data.title || 'Tailored Resume'}</title>
        <style>${data.styles || BASE_STYLES}</style>
      </head>
      <body>
        ${data.headerHtml || `
          <h1>${data.name || 'Candidate Name'}</h1>
          <p style="text-align:center;font-size:13px;">
            ${(data.contact || 'email@example.com • (555) 555-5555 • linkedin.com/in/example')}
          </p>
        `}
        ${sections}
      </body>
      </html>`;
  }
  return RESUME_HTML;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function renderResumeHtml(data = {}, options = {}) {
  const html = buildResumeHtml(data);
  const outputDir = options.outputDir || path.join(__dirname, '..', 'tmp', 'resume-html');
  await ensureDir(outputDir);

  const pdfFileName = options.pdfFileName || data.pdfFileName || 'tailored-resume.pdf';
  const docxFileName = options.docxFileName || data.docxFileName || 'tailored-resume.docx';
  const pdfPath = path.join(outputDir, pdfFileName);
  const docxPath = path.join(outputDir, docxFileName);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let pdfBuffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    pdfBuffer = await page.pdf({
      path: options.writePdf !== false ? pdfPath : undefined,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.2in', bottom: '0.25in', left: '0.25in', right: '0.25in' },
    });
  } finally {
    await browser.close();
  }

  const docxBuffer = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
  });

  if (options.writeDocx !== false) {
    await fs.writeFile(docxPath, docxBuffer);
  }

  return {
    html,
    pdfBuffer,
    docxBuffer,
    pdfPath: options.writePdf !== false ? pdfPath : null,
    docxPath: options.writeDocx !== false ? docxPath : null
  };
}

if (require.main === module) {
  const payloadPath = process.argv[2];
  const payloadPromise = payloadPath
    ? fs.readFile(payloadPath, 'utf8').then(JSON.parse)
    : Promise.resolve({});

  payloadPromise
    .then((data) => renderResumeHtml(data, { writePdf: true, writeDocx: true }))
    .then((result) => {
      console.log('HTML resume exported to:');
      if (result.pdfPath) console.log(' PDF :', result.pdfPath);
      if (result.docxPath) console.log(' DOCX:', result.docxPath);
    })
    .catch((error) => {
      console.error('HTML render failed:', error);
      process.exit(1);
    });
}

module.exports = {
  buildResumeHtml,
  renderResumeHtml
};

