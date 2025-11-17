const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { createHTMLWindow } = require('svgdom');
const htmlToDocx = require('html-to-docx');
const puppeteer = require('puppeteer');
const hyphenationEn = require('hyphenation.en-us');

let latexExports;

function bootstrapDomEnvironment() {
  if (typeof global.window !== 'undefined' && global.window.__latexjs_ready__) {
    return;
  }
  const window = createHTMLWindow();
  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;
  global.self = window;
  window.__latexjs_ready__ = true;
}

function getLatexExports() {
  if (!latexExports) {
    bootstrapDomEnvironment();
    latexExports = require('latex.js');
  }
  return latexExports;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const FONT_MIME_MAP = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
};

function inlineCssUrls(cssContent, cssDir) {
  return cssContent.replace(/url\(([^)]+)\)/g, (match, rawUrl) => {
    const cleaned = rawUrl.trim().replace(/^['"]|['"]$/g, '');
    if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('http')) {
      return match;
    }
    const absolutePath = path.resolve(cssDir, cleaned);
    try {
      const buffer = fsSync.readFileSync(absolutePath);
      const ext = path.extname(absolutePath);
      const mime = FONT_MIME_MAP[ext] || 'application/octet-stream';
      const base64 = buffer.toString('base64');
      return `url("data:${mime};base64,${base64}")`;
    } catch {
      return match;
    }
  });
}

class LatexConverter {
  constructor(options = {}) {
    const latexDistEntry = require.resolve('latex.js');
    this.assetRoot = options.assetRoot || path.dirname(latexDistEntry);
    this.defaultGeneratorOptions = {
      documentClass: options.documentClass || 'article',
      hyphenate: options.hyphenate ?? true,
      languagePatterns: options.languagePatterns || hyphenationEn,
      CustomMacros: options.macros,
      styles: options.styles || [],
    };
    this.defaultPdfOptions = {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      ...options.pdfOptions,
    };
    this.defaultDocxOptions = {
      table: { row: { cantSplit: true } },
      ...options.docxOptions,
    };
  }

  async toHtml(latexSource, generatorOptions = {}) {
    if (typeof latexSource !== 'string' || !latexSource.trim()) {
      throw new Error('LaTeX source must be a non-empty string.');
    }
    const { parse, HtmlGenerator } = getLatexExports();
    const generator = parse(latexSource, {
      generator: new HtmlGenerator({
        ...this.defaultGeneratorOptions,
        ...generatorOptions,
      }),
    });
    const document = generator.htmlDocument();
    await this.#inlineStyles(document, generatorOptions.additionalStyles);
    this.#stripScripts(document);
    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    return { html };
  }

  async toPdf(latexSource, outputPath, options = {}) {
    const { html } = await this.toHtml(latexSource, options.generator);
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...options.launch,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        ...this.defaultPdfOptions,
        ...options.pdf,
      });
      if (outputPath) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, pdfBuffer);
      }
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  async toDocx(latexSource, outputPath, options = {}) {
    const { html } = await this.toHtml(latexSource, options.generator);
    const docxBuffer = await htmlToDocx(html, null, {
      ...this.defaultDocxOptions,
      ...options.docx,
    });
    if (outputPath) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, docxBuffer);
    }
    return docxBuffer;
  }

  async #inlineStyles(document, extraStyles = []) {
    const head = document.querySelector('head');
    if (!head) return;
    const links = Array.from(head.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of links) {
      const href = link.getAttribute('href');
      const absolutePath = this.#resolveAssetPath(href);
      if (!absolutePath || !(await fileExists(absolutePath))) {
        link.parentNode.removeChild(link);
        continue;
      }
      let cssContent = await fs.readFile(absolutePath, 'utf8');
      cssContent = inlineCssUrls(cssContent, path.dirname(absolutePath));
      const styleTag = document.createElement('style');
      styleTag.textContent = cssContent;
      head.replaceChild(styleTag, link);
    }
    for (const stylePath of extraStyles || []) {
      const absolutePath = path.isAbsolute(stylePath)
        ? stylePath
        : path.resolve(stylePath);
      if (!(await fileExists(absolutePath))) continue;
      let cssContent = await fs.readFile(absolutePath, 'utf8');
      cssContent = inlineCssUrls(cssContent, path.dirname(absolutePath));
      const styleTag = document.createElement('style');
      styleTag.textContent = cssContent;
      head.appendChild(styleTag);
    }
  }

  #stripScripts(document) {
    const head = document.querySelector('head');
    if (!head) return;
    const scripts = Array.from(head.querySelectorAll('script'));
    for (const script of scripts) {
      script.parentNode.removeChild(script);
    }
  }

  #resolveAssetPath(relativePath) {
    if (!relativePath) return null;
    if (path.isAbsolute(relativePath)) return relativePath;
    return path.join(this.assetRoot, relativePath);
  }
}

module.exports = { LatexConverter };

