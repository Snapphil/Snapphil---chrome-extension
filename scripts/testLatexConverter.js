const path = require('path');
const fs = require('fs/promises');
const { LatexConverter } = require('../latex/latexConverter');

const SAMPLE_LATEX = `
\\section*{Resume Customization Smoke Test}
This is a short demonstration showing that our LaTeX conversion module can
export to multiple formats. It renders inline math such as $e^{i\\pi} + 1 = 0$
and supports bullet lists:

\\begin{itemize}
  \\item Bullet 1
  \\item Bullet 2
  \\item Bullet 3
\\end{itemize}
`;

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function run() {
  const converter = new LatexConverter();
  const outputDir = path.join(__dirname, '..', 'tmp', 'latex');
  await ensureDir(outputDir);

  const pdfPath = path.join(outputDir, 'sample.pdf');
  const docxPath = path.join(outputDir, 'sample.docx');

  const pdfBuffer = await converter.toPdf(SAMPLE_LATEX, pdfPath);
  const docxBuffer = await converter.toDocx(SAMPLE_LATEX, docxPath);

  console.log('PDF written to', pdfPath, 'size:', pdfBuffer.length, 'bytes');
  console.log('DOCX written to', docxPath, 'size:', docxBuffer.length, 'bytes');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

