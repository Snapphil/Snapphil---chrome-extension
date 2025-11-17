// Background script - handles API calls and messaging with authentication

// LLM provider toggle (single unified flow)
// Set to true to use Cerebras; false to use OpenAI
const USE_CEREBRAS = false;
const OPENAI_MODEL = "gpt-5-mini";
const CEREBRAS_MODEL = "qwen-3-32b";
const model = USE_CEREBRAS ? CEREBRAS_MODEL : OPENAI_MODEL;

// AppScript backend URL
const backendApiUrl = "https://script.google.com/macros/s/AKfycbx51SIMS8LHseKPY907psklUCcZ6QqIayglzVLJnlQPBSFwQI1nwRKFdasDwLOmLliipQ/exec";

// Job site patterns to detect job-related pages
const jobSitePatterns = [
  "linkedin.com/jobs",
  "indeed.com/jobs",
  "indeed.com/viewjob",
  "indeed.com/job",
  "glassdoor.com/job",
  "monster.com/jobs",
  "ziprecruiter.com/jobs",
  "lever.co/",
  "greenhouse.io/jobs",
  "careers.google.com",
  "jobs.apple.com",
  "amazon.jobs",
  "workday.com/",
  "apply.workable.com",
  "smartrecruiters.com",
  "taleo.net/",
  "/apply",
  "job-boards.greenhouse.io/",
  "/job-application",
  "/careers",
  "/vacancy",
  "applicant.tracking",
  "job-details",
  "careers.jobsiteapp"
];

// Function to check if URL is a job-related page
function isJobRelatedPage(url) {
  if (!url) return false;
  
  // Convert to lowercase for case-insensitive matching
  const lowerUrl = url.toLowerCase();
  
  // Check against patterns
  for (const pattern of jobSitePatterns) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, resolve);
    } catch (err) {
      console.error("storageGet failure:", err);
      resolve({});
    }
  });
}

function normalizeLLMOutput(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    try {
      return value.map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          try { return JSON.stringify(part); } catch { return String(part); }
        }
        return String(part ?? '');
      }).join('\n');
    } catch (_) {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value ?? '');
}

function extractTextFromLLMResponse(resp) {
  const outputText = resp?.output_text;
  if (typeof outputText === 'string' && outputText.trim()) return outputText;

  const output = resp?.output;
  if (Array.isArray(output)) {
    const parts = [];
    for (const item of output) {
      if (typeof item === 'string') {
        parts.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') parts.push(item.text);
        if (typeof item.content === 'string') parts.push(item.content);
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (typeof c === 'string') parts.push(c);
            else if (c && typeof c === 'object') {
              if (typeof c.text === 'string') parts.push(c.text);
              if (typeof c.value === 'string') parts.push(c.value);
            }
          }
        }
      }
    }
    if (parts.length) return parts.join('\n');
  }

  const chat = resp?.choices?.[0]?.message?.content;
  if (typeof chat === 'string' && chat.trim()) return chat;
  return '';
}

function extractFirstJsonObject(text) {
  let cleaned = String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  if (cleaned.startsWith('{')) {
    try { return JSON.parse(cleaned); } catch (_) {}
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (_) {
          start = -1;
        }
      }
    }
  }

  throw new Error("LLM response did not include a valid JSON object");
}

function slugifyFilenamePiece(text = '') {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || null;
}

const CUSTOM_RESUME_STORAGE_KEY = 'customResumePreview';
const CUSTOM_RESUME_RENDER_QUEUE_KEY = 'customResumeRenderQueue';

function deriveResumeTextFromStorage(storagePayload = {}) {
  const resumeText =
    storagePayload.resumeTextContent ||
    storagePayload.resumeData?.textContent ||
    storagePayload.resumeFileData?.textContent ||
    storagePayload.resumeFileData?.plainText ||
    '';
  return (resumeText || '').trim();
}

function sanitizeJobRequirements(raw = '') {
  return String(raw || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getResumeAndJobContext(requestPayload = {}) {
  const storageKeys = ['resumeData', 'resumeFileData', 'resumeTextContent', 'userSession', CUSTOM_RESUME_STORAGE_KEY];
  const storagePayload = await storageGet(storageKeys);
  const resumeText = deriveResumeTextFromStorage(storagePayload);
  if (!resumeText) {
    throw new Error("Resume text not found. Please upload a resume first.");
  }

  const jobRequirements = sanitizeJobRequirements(
    requestPayload.jobRequirements ||
    requestPayload.pageText ||
    requestPayload.jobDescription ||
    ''
  );

  if (!jobRequirements) {
    throw new Error("Unable to read job description from this page. Scroll the posting into view and try refresh again.");
  }

  const jobInfo = {
    jobTitle: requestPayload.jobTitle || '',
    companyName: requestPayload.companyName || '',
    jobUrl: requestPayload.jobUrl || '',
    location: requestPayload.location || '',
  };

  return {
    resumeText,
    jobRequirements,
    jobInfo,
    session: storagePayload.userSession || null,
    previousPreview: storagePayload[CUSTOM_RESUME_STORAGE_KEY]
  };
}

function buildResumeDeveloperMessage() {
  return `You are Resume Developer, an assistant that lightly rewrites resumes to fit each job description.
Always output valid JSON with this shape:
{
  "htmlResume": "<!DOCTYPE html>... full HTML ...",
  "highlights": [ "string bullet", ... up to 5 ],
  "tailoringExplanations": [ "I removed X because Y was slightly off from what job desc asked for", ... up to 5 bullets ],
  "pdfFileName": "company-role-tailored-resume.pdf",
  "theme": "serif"
}

PRIMARY GOAL
- Read the candidate resume and job description.
- **Reuse the candidate's existing sections and text** (Professional Experience, Key Projects, Technical Skills, Education, Publications, etc.). Make only light edits: tighten phrasing, inject role keywords, reorder bullets.
- Never invent new roles, projects, or credentials.
- Preserve the visual layout below; fill placeholders with the lightly edited content.

LAYOUT (KEEP THIS EXACT CSS/STRUCTURE)
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{FULL_NAME} — Resume</title>
  <style>
    @page { size: 8.5in 11in; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Garamond', 'Times New Roman', serif;
      font-size: 11pt;
      color: #000;
      line-height: 1.15;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 0.5in;
      background: #fff;
    }
    .header-name {
      font-size: 20pt;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      margin-bottom: 4pt;
    }
    .header-contact {
      font-size: 9pt;
      text-align: center;
      margin-bottom: 4pt;
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 2pt 14pt;
      line-height: 1.35;
      white-space: normal;
    }
    .header-contact span {
      position: relative;
      padding-right: 10pt;
      text-transform: none;
    }
    .header-contact.multi-line span::after {
      content: "•";
      position: absolute;
      right: 2pt;
    }
    .header-contact.multi-line span:last-child::after {
      content: "";
    }
    .header-note {
      font-size: 9pt;
      font-style: italic;
      text-align: center;
      margin-bottom: 8pt;
    }
    .section { margin-bottom: 8pt; }
    .section-title {
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #000;
      padding-bottom: 1pt;
      margin: 6pt 0 4pt 0;
    }
    .two-col { display: flex; gap: 8pt; }
    .two-col > div { flex: 1; }
    .exp-item, .proj-item, .skill-group, .edu-item, .pub-item { margin-bottom: 6pt; }
    .exp-item strong:first-child,
    .proj-item strong:first-child {
      display: block;
      font-weight: 700;
      font-size: 11pt;
      margin-bottom: 2pt;
    }
    .exp-header, .edu-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 2pt;
    }
    .exp-title { font-weight: 700; font-size: 11pt; }
    .exp-meta { font-size: 10pt; font-style: italic; white-space: nowrap; }
    ul { margin: 0 0 0 18pt; padding: 0; list-style-position: outside; }
    li { margin-bottom: 2pt; font-size: 10pt; line-height: 1.25; }
    .skills-row {
      list-style-type: disc;
      margin: 0 0 0 16pt;
      padding: 0;
      font-size: 10pt;
      display: block;
      column-gap: 0;
      row-gap: 0;
    }
    .skills-row li {
      margin-bottom: 2pt;
      line-height: 1.15;
    }
  </style>
</head>
<body>
  <div class="header-name">{FULL_NAME_UPPER}</div>
  <div class="header-contact">{CONTACT_LINE}</div>
  <div class="header-note">{WORK_AUTH_LINE}</div>

  <div class="section">
    <div class="section-title">PROFESSIONAL EXPERIENCE</div>
    {EXPERIENCE_BLOCKS}
  </div>

  <div class="section">
    <div class="section-title">{PROJECT_SECTION_TITLE}</div>
    {PROJECT_BLOCKS}
  </div>

  <div class="section">
    <div class="section-title">TECHNICAL SKILLS</div>
    {SKILL_BLOCKS}
  </div>

  <div class="section two-col">
    <div>
      <div class="section-title">EDUCATION</div>
      {EDUCATION_BLOCKS}
    </div>
    <div>
      <div class="section-title">PUBLICATIONS</div>
      {PUBLICATION_BLOCKS}
    </div>
  </div>
</body>
</html>

CONTENT RULES
1. Single page; reuse every original section (Experience, Projects, Skills, Education, Publications). Add/remove bullets only if necessary for fit.
2. Experience: keep same jobs/dates/order unless job relevance suggests rearranging. Max 4 bullets per role.
3. Projects and skills: keep same entries; present skills as concise bullet lists or comma-separated text (no pill styling).
4. Do not add or reference a summary section—begin the document with Professional Experience.
5. Education & publications: keep all existing entries with same metrics, convert to short blocks.
6. Contact info: Replace {CONTACT_LINE} with actual contact details from resume. Format as: <div class="header-contact"><span>phone</span><span>email</span><span>github</span><span>linkedin</span></div>
7. Work-auth note ≤100 chars (status + target role) if available; otherwise just work authorization. Replace {WORK_AUTH_LINE} with actual text or leave empty if none.
8. Use en-dashes for ranges; maintain metrics exactly as given.
9. Replace ALL template placeholders ({FULL_NAME_UPPER}, {CONTACT_LINE}, {WORK_AUTH_LINE}, {EXPERIENCE_BLOCKS}, etc.) with actual HTML content—never leave placeholders or JavaScript variables in the output.
10. Section titles stay uppercase; render job titles/companies with bold text but no underlines or strikethrough.
11. Always include the education block—even if unchanged—so ATS parsers see degrees/dates. Replace {EDUCATION_BLOCKS} with actual education HTML.

TAILORING GUIDELINES
- Edit lightly: prefer swapping verbs, adding role keywords, or reordering bullets over rewriting.
- Preserve actual numbers, technologies, employers, and scope.
- Emphasize bullets relevant to the target role; drop the least relevant only if space-constrained.
- Section titles stay in uppercase as shown; only "PROJECT_SECTION_TITLE" can change (e.g., “KEY PROJECTS IN GENAI”).

HIGHLIGHTS ARRAY
- Up to 5 bullets explaining the edits (<=120 chars, start with section name, no colon).

TAILORING EXPLANATIONS ARRAY
- Up to 5 detailed bullets explaining specific changes made and why (format: "Removed [item] because JD prioritized [reason]")
- Examples:
  - "Removed AWS Lambda project because job description prioritizes GCP over AWS"
  - "Moved frontend development experience up because role is primarily React-focused"
  - "Emphasized ML/AI keywords because job requires generative AI launches"
- These bullets are for the UI checklist only—do not embed them into the resume body.

EXAMPLE OUTPUT (contact section only):
<div class="header-name">JOHN DOE</div>
<div class="header-contact">
  <span>+1 555-123-4567</span>
  <span>john.doe@email.com</span>
  <span>github.com/johndoe</span>
  <span>linkedin.com/in/johndoe</span>
</div>
<div class="header-note">F-1 (NYU) CPT eligible Fall 2025/2026 • NYC/Remote</div>

CRITICAL: Never use template literals (\${variable}), placeholders ({VARIABLE}), or undefined JavaScript variables in the HTML. Output must be complete, static HTML with all actual values filled in.

Do not copy example text verbatim. Use resume + job description as source of truth.`;
}

function buildResumeUserMessage(payload) {
  const { resumeText, jobRequirements, jobInfo } = payload;
  const headingPieces = [];
  if (jobInfo.jobTitle) headingPieces.push(`Role: ${jobInfo.jobTitle}`);
  if (jobInfo.companyName) headingPieces.push(`Company: ${jobInfo.companyName}`);
  if (jobInfo.location) headingPieces.push(`Location: ${jobInfo.location}`);
  if (jobInfo.jobUrl) headingPieces.push(`Job URL: ${jobInfo.jobUrl}`);

  return [
    headingPieces.join(' • ') || 'Target role information unknown.',
    '',
    'Primary resume text (verbatim from user upload):',
    '"""',
    resumeText,
    '"""',
    '',
    'Job posting requirements / responsibilities:',
    '"""',
    jobRequirements,
    '"""',
    '',
    'Instructions:',
    '- Align accomplishments to the job requirements.',
    '- Preserve actual achievements; never fabricate employment history.',
    '- Do not generate a summary section; begin with Professional Experience.',
    '- Prefer concise bullet points (max 2 lines each).',
    '- Return the JSON described by the system message only.'
  ].join('\n');
}

async function callResumeDeveloperModel(payload) {
  const developerMessage = buildResumeDeveloperMessage();
  const userMessage = buildResumeUserMessage(payload);

  const requestData = {
    model: model,
    input: [
      { role: "system", content: [{ type: "input_text", text: developerMessage }] },
      { role: "user", content: [{ type: "input_text", text: userMessage }] }
    ],
    text: { format: { type: "json_object" }, verbosity: "medium" },
    reasoning: { summary: "auto", effort: "medium" },
    messages: [
      { role: "system", content: developerMessage },
      { role: "user", content: userMessage }
    ]
  };

  const response = await fetch(backendApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'callLLM',
      provider: USE_CEREBRAS ? 'cerebras' : 'openai',
      userId: payload.session?.userId || null,
      sessionToken: payload.session?.sessionToken || null,
      requestData
    })
  });

  if (!response.ok) {
    throw new Error(`Resume Developer request failed (${response.status})`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Resume Developer backend error");
  }

  const openAIResponse = result.data;
  const rawText = normalizeLLMOutput(extractTextFromLLMResponse(openAIResponse));
  if (!rawText) {
    throw new Error("Resume Developer returned empty output");
  }

  const parsed = extractFirstJsonObject(rawText);
  if (!parsed?.htmlResume) {
    throw new Error("Resume Developer response missing htmlResume field");
  }

  // Check for unresolved placeholders or JavaScript template literals
  const html = parsed.htmlResume;
  const problematicPatterns = [
    /\$\{[^}]+\}/g,  // Template literals like ${variable}
    /\{[A-Z_]+\}/g,  // Placeholders like {CONTACT_LINE}
  ];
  
  for (const pattern of problematicPatterns) {
    const matches = html.match(pattern);
    if (matches) {
      console.warn('Resume contains unresolved placeholders:', matches);
      throw new Error(`Generated HTML contains unresolved placeholders: ${matches.slice(0, 3).join(', ')}. Please regenerate.`);
    }
  }

  const fallbackNameParts = [
    payload.jobInfo?.companyName,
    payload.jobInfo?.jobTitle,
    "resume"
  ].filter(Boolean);

  return {
    htmlResume: parsed.htmlResume,
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
    tailoringExplanations: Array.isArray(parsed.tailoringExplanations) ? parsed.tailoringExplanations : [],
    pdfFileName: parsed.pdfFileName || `${fallbackNameParts.join('-') || 'tailored-resume'}-${Date.now()}.pdf`,
    theme: parsed.theme || 'serif'
  };
}

async function queueResumeRendererJob(htmlResume, meta) {
  const queueItem = {
    id: `resume-${Date.now()}`,
    html: htmlResume,
    meta,
    requestedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [CUSTOM_RESUME_RENDER_QUEUE_KEY]: queueItem });
  return queueItem;
}

async function persistTailoredResumeAssets(payload) {
  const { htmlResume, highlights, tailoringExplanations, pdfFileName } = payload;
  const meta = {
    pdfFileName,
    generatedAt: new Date().toISOString(),
    highlights,
    tailoringExplanations,
    jobInfo: payload.jobInfo || null
  };

  await chrome.storage.local.set({
    [CUSTOM_RESUME_STORAGE_KEY]: {
      html: htmlResume,
      meta
    }
  });

  saveTailoredResumeHtml(htmlResume, meta);

  const queueItem = await queueResumeRendererJob(htmlResume, meta);
  return { meta, queueItem };
}

// Function to save payload to text file
function savePayloadToFile(payload) {
  try {
    // Convert payload to string
    const payloadStr = JSON.stringify(payload, null, 2);
    
    // Create timestamp for unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `autofill_payload_${timestamp}.txt`;
    
    // Create download directory
    const downloadDir = 'JobApplicationAutomator';
    
    // Use the downloads API with data URL instead of blob URL
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(payloadStr);
    
    chrome.downloads.download({
      url: dataUrl,
      filename: `${downloadDir}/${filename}`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
      } else {
        console.log(`Payload saved to ${downloadDir}/${filename}`);
      }
    });
  } catch (error) {
    console.error('Error saving payload to file:', error);
  }
}

function saveTailoredResumeHtml(htmlResume, meta = {}) {
  if (!htmlResume) return;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobInfo = meta.jobInfo || {};
    const parts = [
      slugifyFilenamePiece(jobInfo.companyName),
      slugifyFilenamePiece(jobInfo.jobTitle)
    ].filter(Boolean);
    const baseName = parts.join('-') || 'tailored-resume';
    const filename = `${baseName}-${timestamp}.html`;
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlResume);

    chrome.downloads.download({
      url: dataUrl,
      filename: `JobApplicationAutomator/${filename}`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save tailored resume HTML:', chrome.runtime.lastError);
      } else {
        console.log(`Tailored resume HTML saved as ${filename} (downloadId: ${downloadId})`);
      }
    });
  } catch (error) {
    console.error('Error saving tailored resume HTML:', error);
  }
}

// ==========================================================================
// Browser Action (Toolbar Icon) Click Handler
// --------------------------------------------------------------------------
// We're now using a popup instead of toggling the settings panel directly.
// The popup handles its own actions to either start autofill or open the 
// settings panel.
// ==========================================================================

// Function to update token usage in local storage and server
async function updateTokenUsage(tokenCount, userId, sessionToken) {
  // Skip if token count is invalid
  if (!tokenCount || tokenCount <= 0) return;
  
  console.log(`Updating token usage: ${tokenCount} tokens`);
  
  // If we have a userId and sessionToken, update the server
  if (userId && sessionToken) {
    try {
      const tokenResponse = await fetch(backendApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'trackTokenUsage',
          userId: userId,
          sessionToken: sessionToken,
          tokenCount: tokenCount,
          description: "Form analysis and filling"
        })
      });
      
      const tokenData = await tokenResponse.json();
      if (tokenData.success) {
        console.log("Token usage tracked in backend:", tokenData);
        return tokenData.tokenUsage;
      }
    } catch (error) {
      console.error("Error tracking token usage in backend:", error);
    }
  }
  
  // Update local storage as fallback or if not logged in
  let totalTokens = 0;
  chrome.storage.local.get('tokenUsage', function(result) {
    const currentTokens = result.tokenUsage || 0;
    totalTokens = currentTokens + tokenCount;
    
    chrome.storage.local.set({ tokenUsage: totalTokens });
    console.log(`Token usage updated locally: Total ${totalTokens} tokens`);
  });
  
  return totalTokens;
}

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI-Powered Job Application Automator installed');
  
  // Initialize settings if not already set
  chrome.storage.local.get(['apiKey', 'settings'], (result) => {
    // Initialize API key if provided
    if (result.apiKey) {
      apiKey = result.apiKey;
    }
    
    // Initialize settings if not set
    if (!result.settings) {
      chrome.storage.local.set({
        settings: {
          autoSubmit: false,
          darkMode: true,
          notifications: true
        }
      });
    }
  });
  
  // Get autoOpenPopup setting or set default
  chrome.storage.local.get(['autoOpenPopup'], (result) => {
    if (result.autoOpenPopup === undefined) {
      chrome.storage.local.set({ autoOpenPopup: true });
    }
  });
});

// Listen for tab updates to detect job pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only run when page is fully loaded and has a valid URL
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if auto-open is enabled
    chrome.storage.local.get(['autoOpenPopup'], (result) => {
      const autoOpenEnabled = result.autoOpenPopup !== false; // Default to true
      
      if (autoOpenEnabled && isJobRelatedPage(tab.url)) {
        console.log(`Job page detected: ${tab.url}`);
        
        // Add a small delay to let the page fully render
        setTimeout(() => {
          // Programmatically open popup
          chrome.action.openPopup();
          
          // Notify content script (if loaded) that we're on a job page
          try {
            chrome.tabs.sendMessage(tabId, { action: 'jobPageDetected' }, () => {
              // Intentionally ignore missing receiver errors
              void chrome.runtime.lastError;
            });
          } catch (e) {
            console.log("Content script not ready yet");
          }
        }, 1000);
      }
    });
  }
});

// Get active user session
function getActiveSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['userSession'], (result) => {
      resolve(result.userSession || null);
    });
  });
}

// Get user context data from storage or server
async function getUserContext() {
  try {
    // First check storage for context
    const storageData = await new Promise((resolve) => {
      chrome.storage.local.get('contextData', (result) => {
        resolve(result.contextData || null);
      });
    });
    
    // If we have context in storage, use it
    if (storageData) {
      return storageData;
    }
    
    // Otherwise, check if user is logged in and try to get context from server
    const session = await getActiveSession();
    if (session) {
      try {
        const response = await fetch(`${backendApiUrl}?action=getUserContext&userId=${session.userId}&sessionToken=${session.sessionToken}`);
        const data = await response.json();
        
        if (data.success && data.contextData) {
          // Save to local storage for future use
          chrome.storage.local.set({ contextData: data.contextData });
          return data.contextData;
        }
      } catch (error) {
        console.error('Error fetching user context from server:', error);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
}

// Make the API request to GPT-4.1-nano
async function callGPT41API(formElements, resumeData, pageText, actionHistory) {
  try {
    // Get model configuration
    console.log(`Using ${model} for form analysis`);
    
    // Get user context to pass to the AI
    const contextData = await getUserContext().catch(err => {
      console.warn("Error getting user context, proceeding without it:", err);
      return null;
    });
    
    // Get current user session
    const session = await getActiveSession().catch(err => {
      console.warn("Error getting user session, proceeding without it:", err);
      return null;
    });
    
    // Get cover letter settings - with robust error handling
    let coverLetterSettings = null;
    try {
      // First try the normal path
      if (typeof getCoverLetterSettings === 'function') {
        coverLetterSettings = await getCoverLetterSettings();
      } else {
        // Fallback: Direct storage access if function not available
        coverLetterSettings = await new Promise(resolve => {
          chrome.storage.local.get(['coverLetterSettings'], result => {
            resolve(result.coverLetterSettings || null);
          });
        });
      }
    } catch (err) {
      console.warn("Error getting cover letter settings, proceeding without them:", err);
      coverLetterSettings = null;
    }
    
    // Get advanced settings
    const advancedSettings = await getAdvancedSettings().catch(err => {
      console.warn("Error getting advanced settings, using defaults:", err);
      return {
        fillOptionalFields: true,
        enhancedJobMatching: true,
        autosaveApplications: false,
        aiPersonality: "Professional (Default)"
      };
    });
    
    // Instead of returning early, proceed with empty or default user data
    if (!session) {
      console.log("No active session, proceeding with limited functionality");
      // Continue with the process, but note that some features may be limited
    }
    
    // Pre-process form elements to emphasize file upload fields
    const processedFormElements = {...formElements};
    
    // Check for file inputs and mark them clearly for the AI
    if (processedFormElements.fileInputs && processedFormElements.fileInputs.length > 0) {
      console.log(`Found ${processedFormElements.fileInputs.length} file inputs to process`);
      
      // Process each file input to provide better hints to the AI
      processedFormElements.fileInputs = processedFormElements.fileInputs.map(fileInput => {
        const labelText = fileInput.labelText ? fileInput.labelText.toLowerCase() : '';
        const domId = fileInput.domId ? fileInput.domId.toLowerCase() : '';
        const name = fileInput.name ? fileInput.name.toLowerCase() : '';
        
        // Add a recommendation field for the AI
        let recommendation = '';
        
        if (labelText.includes('resume') || labelText.includes('cv') || 
            domId.includes('resume') || domId.includes('cv') || 
            name.includes('resume') || name.includes('cv')) {
          recommendation = 'resumeFile';
        } else if (labelText.includes('cover') || labelText.includes('letter') || 
                  domId.includes('cover') || domId.includes('letter') || 
                  name.includes('cover') || name.includes('letter')) {
          recommendation = 'coverLetterFile';
        }
        
        return {
          ...fileInput,
          recommendation: recommendation
        };
      });
    }
    
    // Format user message with all the form data
    let userMessage = `
Current webpage form elements:
${JSON.stringify(processedFormElements, null, 2)}
`;

    // Create a copy of resume data without the content field
    const resumeDataForAPI = { ...resumeData };
    if (resumeDataForAPI.content) {
      delete resumeDataForAPI.content;
    }
    
    // Add resume data, page text, action history, and context to the message
    userMessage += `
User's resume:
${JSON.stringify(resumeDataForAPI, null, 2)}

Page text content:
${pageText}

Action history:
${JSON.stringify(actionHistory, null, 2)}
`;

    if (contextData) {
      userMessage += `\nUser context and preferences:
${JSON.stringify(contextData, null, 2)}`;
    }
    
    // Add cover letter settings if available
    if (coverLetterSettings) {
      userMessage += `\nCover letter preferences:
${JSON.stringify(coverLetterSettings, null, 2)}`;
    }
    
    // Add advanced settings if available
    if (advancedSettings) {
      userMessage += `\nAdvanced settings:\n${JSON.stringify(advancedSettings, null, 2)}`;
    }
    
    // Add special instructions for resume and cover letter handling
    userMessage += `\nIMPORTANT INSTRUCTIONS FOR HANDLING FILE UPLOADS:\n1. For any file upload fields, use the 'upload' action type.\n2. For resume uploads, use value=\"resumeFile\" - the extension will handle the actual file.\n3. For cover letter uploads, use value=\"coverLetterFile\" - the extension will generate and upload a cover letter automatically.\n4. Resume and cover letter uploads are high priority - please identify and handle them if present on the form.\n`;

    
    // Format user message with all the form data
    let userMessageFormatted = `
Current webpage form elements:
${JSON.stringify(processedFormElements, null, 2)}
`;

    // Create a copy of resume data without the content field
    const resumeDataForAPIFormatted = { ...resumeData };
    if (resumeDataForAPIFormatted.content) {
      delete resumeDataForAPIFormatted.content;
    }
    
    // Add resume data, page text, action history, and context to the message
    userMessageFormatted += `
User's resume:
${JSON.stringify(resumeDataForAPIFormatted, null, 2)}

Page text content:
${pageText}

Action history:
${JSON.stringify(actionHistory, null, 2)}
`;

    if (contextData) {
      userMessageFormatted += `\nUser context and preferences:
${JSON.stringify(contextData, null, 2)}`;
    }
    
    // Add cover letter settings if available
    if (coverLetterSettings) {
      userMessageFormatted += `\nCover letter preferences:
${JSON.stringify(coverLetterSettings, null, 2)}`;
    }
    
    // Add advanced settings if available
    if (advancedSettings) {
      userMessageFormatted += `\nAdvanced settings:\n${JSON.stringify(advancedSettings, null, 2)}`;
    }
    
    // Add special instructions for resume and cover letter handling
    userMessage += `
IMPORTANT INSTRUCTIONS FOR HANDLING FILE UPLOADS:
1. For any file upload fields, use the 'upload' action type.
2. For resume uploads, use value="resumeFile" - the extension will handle the actual file.
3. For cover letter uploads, use value="coverLetterFile" - the extension will generate and upload a cover letter automatically.
4. Resume and cover letter uploads are high priority - please identify and handle them if present on the form.
`;
    
    // Developer message (keeping your existing prompt)
    const developerMessage = `
You are a specialized AI assistant that helps automate job application processes. You analyze information about web form elements and determine what data to fill in each field based on the user's resume.

You will receive information about the form elements on the current page, including:
1. Text inputs, textareas, select dropdowns, checkboxes, radio buttons, and file inputs
2. The user's structured resume data
3. History of previous actions taken
4. Additional context information about the user's preferences
5. Cover letter styling preferences
6. Advanced settings that control your behavior

Your task is to determine what data to enter in each form field by returning a JSON object with:
{
  "formActions": [
    {
      "elementId": "unique-element-identifier",  // Identifier to reference the form element
      "action": "fill",                          // Action to take (fill, select, check, upload, click)
      "value": "data to fill",                   // Value to enter/select/etc.
      "confidence": 90,                          // Confidence score 0-100
      "explanation": "Filling name field"        // Brief explanation
    },
    // More actions for other fields...
  ],
  "submitForm": true/false,                      // Whether to click submit button after filling
  "explanation": "Overall explanation...",       // General explanation of decisions
  "coverLetter": {                               // Cover letter generation when job description is present
    "content": "Full cover letter text...",      // The complete cover letter (200-400 words)
    "filename": "Cover_Letter_Company_Position.pdf", // Suggested filename
    "keywords": ["skill1", "skill2"]            // Keywords used from job description
  }
}

For dropdown menus, provide the exact value to select from the options.
For checkboxes and radio buttons, indicate true/false or the value to select.
For file uploads, determine whether it's for resume or cover letter:
- For resume uploads, use "resumeFile" as the value
- For cover letter uploads, use "coverLetterFile" as the value

When filling application forms:
- Match fields with resume sections based on labels, placeholders, and field types
- For job title fields, use titles from the resume
- For work experience, education, and skills, extract relevant information from the resume
- For custom questions in text fields, provide answers between 150-300 words

ADVANCED SETTINGS INSTRUCTIONS:
- If "fillOptionalFields" is true, fill in all fields including optional ones
- If "enhancedJobMatching" is true, tailor responses to better match job descriptions
- If "autosaveApplications" is true, track all applications even if not submitted
- Adjust your tone and style based on the "aiPersonality" setting:
  - "Professional (Default)": Formal, straightforward responses
  - "Enthusiastic": More energetic, passionate tone
  - "Technical": Focus on technical details and precision
  - "Creative": More expressive and distinctive style

COVER LETTER GENERATION:
- Generate a custom cover letter (200-400 words) based on the job description and resume
- Respect the user's cover letter preferences as provided:
  - Style preference (Professional, Creative, Academic, or Concise)
  - Include specific achievements if requested (with metrics and results)
  - Include company research if requested (showing knowledge of company mission and values)
  - Include salary expectations only when indicated and if requested in the job description
  - Use the custom closing statement if provided, otherwise generate an appropriate closing
- Include relevant keywords from the job description to increase selection chances
- Organize in proper business letter format with clear introduction, body, and conclusion
- Highlight the applicant's most relevant skills and experiences
- Suggest a filename that includes the company and position

PRIORITY ACTIONS:
1. Look for "Upload Resume" and "Upload Cover Letter" buttons first - this simplifies the application
2. Fill in required fields (often marked with asterisks)
3. Provide appropriate responses for all detected fields
4. Recommend submitting the form when all requirements are met

CONSIDER USER PREFERENCES:
- Use the provided context information to tailor responses to the user's preferences
- Pay attention to location preferences, job title preferences, and other context
- If context information indicates specific preferences (like remote work), emphasize these in custom responses
- If the user has answered MCQ questions, use those responses to tailor your approach

Use the provided resume data to make smart decisions about what to enter in each field.
`;

    // Unified payload containing both Responses-style `input` (for OpenAI gpt-5) and
    // chat-completions-compatible `messages` (for Cerebras and fallbacks).
    const requestData = {
      model: model,
      // Responses API input for OpenAI gpt-5 models
      input: [
        {
          role: "system",
          content: [ { type: "input_text", text: developerMessage } ]
        },
        {
          role: "user",
          content: [ { type: "input_text", text: userMessage } ]
        }
      ],
      text: { format: { type: "json_object" }, verbosity: "medium" },
      reasoning: { summary: "auto", effort: "medium" },
      // Chat Completions-compatible payload for Cerebras
      messages: [
        { role: "system", content: developerMessage },
        { role: "user", content: userMessage }
      ],
    };
    
    // Save payload for debugging
    //savePayloadToFile(requestData);
    
    // Log and time the API call for developer debugging
    console.log(`[${new Date().toISOString()}] Starting LLM API call (provider=${USE_CEREBRAS ? 'cerebras' : 'openai'}, model=${model})...`);
    console.time('gpt-api-call');
    
    // Track start time for calculating elapsed time
    const apiCallStartTime = Date.now();
    
    // Send progress signal to content script to show loading indicator
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "apiCallProgress",
            status: "start",
            model: model
          }, () => { void chrome.runtime.lastError; });
        } catch (e) {
          console.log("Error sending progress signal:", e);
        }
      }
    });
    
    // Make the server-side API request
    const response = await fetch(backendApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'callLLM',
        provider: USE_CEREBRAS ? 'cerebras' : 'openai',
        userId: session && session.userId ? session.userId : null,
        sessionToken: session && session.sessionToken ? session.sessionToken : null,
        requestData: requestData
      })
    });
    
    // Log the API call completion and elapsed time
    const apiCallEndTime = Date.now();
    const elapsedTime = (apiCallEndTime - apiCallStartTime) / 1000; // Convert to seconds
    console.timeEnd('gpt-api-call');
    console.log(`[${new Date().toISOString()}] Completed LLM API call in ${elapsedTime.toFixed(2)}s`);
    
    // Send completion signal to content script
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "apiCallProgress",
            status: "complete",
            elapsedTime: elapsedTime.toFixed(2),
            preserveLogs: true
          }, () => { void chrome.runtime.lastError; });
        } catch (e) {
          console.log("Error sending completion signal:", e);
        }
      }
    });
    
    // Handle response
    if (!response.ok) {
      const errorText = await response.text();
      return { 
        error: true, 
        message: `Server Error (${response.status}): ${errorText}` 
      };
    }
    
    const result = await response.json();
    
    if (!result.success) {
      return { 
        error: true, 
        message: result.error || "Server processing error" 
      };
    }
    
    // Process Responses API result
    const openAIResponse = result.data;
    const content = normalizeLLMOutput(extractTextFromLLMResponse(openAIResponse));
    const tokenUsage = openAIResponse?.usage?.total_tokens || 0;
    
    if (!content) {
      return { 
        error: true, 
        message: "Empty response from API" 
      };
    }
    
    // Parse and process the result
    try {
      console.log("Parsing cleaned API response...");
      const decision = extractFirstJsonObject(content);
      if (!decision) {
        console.error("No valid JSON found in response:", content);
        return {
          error: true,
          message: "API response does not contain valid JSON"
        };
      }
      decision.tokenUsage = tokenUsage;
      
      console.log(`API call used ${tokenUsage} tokens`);
      
      // Update token usage counters
      try {
        chrome.runtime.sendMessage({
          action: "tokenUsageUpdated",
          tokenCount: tokenUsage,
          totalTokens: tokenUsage
        }, () => { void chrome.runtime.lastError; });
      } catch (e) {
        console.log("No active popup to update token count");
      }
      
      // Handle cover letter if generated
      if (decision.coverLetter && decision.coverLetter.content) {
        // Get active session
        const session = await getActiveSession();
        
        // Update filename to use .pdf extension
        let filename = decision.coverLetter.filename || "Cover_Letter.pdf";
        if (!filename.toLowerCase().endsWith('.pdf')) {
          filename = filename.replace(/\.[^/.]+$/, "") + ".pdf"; // Replace any extension with .pdf
        }
        
        if (session) {
          console.log("Saving cover letter to backend...");
          // Create cover letter object
          const newCoverLetter = {
            id: Date.now().toString(), // Use timestamp as ID
            filename: filename,
            content: decision.coverLetter.content,
            keywords: decision.coverLetter.keywords || [],
            createdAt: new Date().toISOString(),
            jobTitle: decision.jobTitle || "",
            company: decision.company || ""
          };
          
          // Save to backend if logged in
          try {
            const response = await fetch(backendApiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                action: 'saveCoverLetter',
                userId: session.userId, 
                sessionToken: session.sessionToken,
                content: newCoverLetter.content,
                fileName: newCoverLetter.filename,
                jobTitle: newCoverLetter.jobTitle,
                company: newCoverLetter.company
              })
            });
            
            const data = await response.json();
            
            if (data.success) {
              console.log("Cover letter saved to backend:", data);
              // Add backend ID to the cover letter
              newCoverLetter.backendId = data.coverLetterId;
              newCoverLetter.url = data.url;
              newCoverLetter.downloadUrl = data.downloadUrl;
              
              // Store the cover letter ID for tracking the application
              decision.coverLetterId = data.coverLetterId;
            } else {
              console.error("Error saving cover letter to backend:", data.error);
            }
          } catch (error) {
            console.error("Error saving cover letter to backend:", error);
          }
          
          // Store locally and prepare for backend sync
          storeCoverLetterLocally(newCoverLetter);
        } else {
          // Only store locally if not logged in
          storeCoverLetterLocally({
            id: Date.now().toString(),
            filename: decision.coverLetter.filename || "Cover_Letter.pdf",
            content: decision.coverLetter.content,
            keywords: decision.coverLetter.keywords || [],
            createdAt: new Date().toISOString(),
            jobTitle: decision.jobTitle || "",
            company: decision.company || ""
          });
        }
      }
      
      return decision;
    } catch (error) {
      console.error("JSON parsing error:", error);
      console.error("Original content:", content);
      
      return { 
        error: true, 
        message: `Error parsing API response: ${error.message}. Content preview: ${String(content).substring(0, 200)}...` 
      };
    }
  } catch (error) {
    return { 
      error: true, 
      message: `Request failed: ${error.message}` 
    };
  }
}

// Store cover letter locally and prepare for backend sync
function storeCoverLetterLocally(coverLetter) {
  try {
    // Store the generated cover letter data
    chrome.storage.local.set({
      'lastGeneratedCoverLetter': {
        content: coverLetter,
        generatedAt: new Date().toISOString(),
        fileName: `cover-letter-${Date.now()}.pdf`
      }
    });
    
    // Also save to backend if user is authenticated
    chrome.storage.local.get(['userSession'], async (result) => {
      if (result.userSession && result.userSession.userId && result.userSession.sessionToken) {
        try {
          const fileName = `cover-letter-${Date.now()}.pdf`;
          const jobTitle = "Generated Cover Letter"; // You might want to extract this from context
          const company = "Unknown Company"; // You might want to extract this from context
          
          const saveResult = await saveCoverLetterToBackend(
            result.userSession.userId,
            result.userSession.sessionToken,
            typeof coverLetter === 'string' ? coverLetter : coverLetter?.content || '',
            fileName,
            jobTitle,
            company
          );
          
          if (saveResult.success) {
            // Store the cover letter ID for linking to applications
            chrome.storage.local.set({
              'lastGeneratedCoverLetter': {
                content: coverLetter,
                generatedAt: new Date().toISOString(),
                fileName: fileName,
                coverLetterId: saveResult.coverLetterId,
                fileId: saveResult.fileId,
                downloadUrl: saveResult.downloadUrl
              }
            });
            
            console.log("Cover letter saved to backend successfully");
          } else {
            console.error("Failed to save cover letter to backend:", saveResult.error);
          }
        } catch (error) {
          console.error("Error saving cover letter to backend:", error);
        }
      }
    });
  } catch (error) {
    console.error("Error storing cover letter locally:", error);
  }
}

// Save cover letter to backend
async function saveCoverLetterToBackend(userId, sessionToken, content, fileName, jobTitle, company) {
  try {
    const response = await fetch(backendApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'saveCoverLetter',
        userId: userId,
        sessionToken: sessionToken,
        content: content,
        fileName: fileName,
        jobTitle: jobTitle,
        company: company
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error("Error saving cover letter to backend:", error);
    return { success: false, error: "API request failed" };
  }
}

// Check if content script is already loaded in a tab before injecting
async function isContentScriptLoaded(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => typeof window.jobAppAutomatorLoaded !== 'undefined'
    });
    return results[0]?.result === true;
  } catch (error) {
    console.log("Error checking if content script is loaded:", error);
    return false;
  }
}

// Function to generate a PDF from text using jsPDF
function generatePDFFromText(text, filename) {
  return new Promise((resolve, reject) => {
    try {
      // Check if jsPDF is already loaded
      if (typeof window.jspdf === 'undefined') {
        console.log('Loading jsPDF library...');
        
        // Create script element to load jsPDF
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => {
          console.log('jsPDF library loaded successfully');
          generatePDF();
        };
        script.onerror = (err) => {
          console.error('Failed to load jsPDF library:', err);
          reject(new Error('Failed to load jsPDF library'));
        };
        document.head.appendChild(script);
      } else {
        console.log('jsPDF already loaded, generating PDF...');
        generatePDF();
      }
      
      function generatePDF() {
        try {
          console.log('Creating PDF document...');
          // Create jsPDF instance
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF();
          
          // Set decent margins
          const margin = 20;
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          const maxWidth = pageWidth - (margin * 2);
          
          // Add the content, split into paragraphs
          const paragraphs = text.split("\n\n");
          let yPos = margin;
          const lineHeight = 7;
          
          // Add title at the top
          doc.setFontSize(16);
          doc.setFont("helvetica", "bold");
          doc.text("Cover Letter", margin, yPos);
          yPos += lineHeight * 2;
          
          // Normal text formatting
          doc.setFontSize(11);
          doc.setFont("helvetica", "normal");
          
          // Process each paragraph
          paragraphs.forEach(paragraph => {
            // Skip empty paragraphs
            if (!paragraph.trim()) return;
            
            // Split text to fit within margins
            const textLines = doc.splitTextToSize(paragraph, maxWidth);
            doc.text(textLines, margin, yPos);
            
            // Update position for next paragraph
            yPos += textLines.length * lineHeight + 5;
            
            // Add a new page if needed
            if (yPos > pageHeight - margin) {
              doc.addPage();
              yPos = margin;
            }
          });
          
          console.log('PDF created, converting to data URL...');
          // Get PDF as data URL
          const pdfData = doc.output('datauristring');
          
          resolve(pdfData);
        } catch (error) {
          console.error('Error generating PDF:', error);
          reject(error);
        }
      }
    } catch (error) {
      console.error('Error in PDF generation process:', error);
      reject(error);
    }
  });
}

// Update user context in server
async function updateUserContext(userId, sessionToken, contextData) {
  try {
    const response = await fetch(backendApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'updateUserContext',
        userId: userId,
        sessionToken: sessionToken,
        contextData: contextData
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error("Error updating user context:", error);
    return { success: false, error: "API request failed" };
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzeFormWithAI") {
    // Get form elements, resume data, and use AI to decide what to fill
    console.log(`[${new Date().toISOString()}] Received analyzeFormWithAI request`);
    console.time('ai-analysis');
    const { formElements, pageText, actionHistory, useFallbackSettings } = message;
    
    // Special handling for fallback settings request
    if (useFallbackSettings) {
      console.log(`[${new Date().toISOString()}] Using fallback settings approach due to request flag`);
    }
    
    // Get resume data from storage
    chrome.storage.local.get(['resumeData', 'contextData', 'userSession', 'coverLetterSettings'], async (result) => {
      if (!result.resumeData) {
        console.error(`[${new Date().toISOString()}] No resume data found`);
        sendResponse({ error: true, message: "Resume data not found. Please upload a resume first." });
        console.timeEnd('ai-analysis');
        return;
      }
      
      console.log(`[${new Date().toISOString()}] Found resume data, checking for updates...`);
      
      // Check if user is logged in
      const session = result.userSession;
      
      // Cache cover letter settings for fallback use
      const fallbackCoverLetterSettings = result.coverLetterSettings;
      
      // If logged in, check if we need to get a more recent resume
      let resumeData = result.resumeData;
      let shouldUpdateResumeFromServer = false;
      
      if (session) {
        try {
          // Get last update timestamp from storage
          chrome.storage.local.get(['resumeLastServerCheck'], async (checkResult) => {
            const lastCheck = checkResult.resumeLastServerCheck || 0;
            const now = Date.now();
            const oneHourMs = 60 * 60 * 1000;
            
            // Only check server if we haven't checked in the last hour
            // or if this is a settings panel-triggered check
            if ((now - lastCheck > oneHourMs) || message.forceResumeRefresh) {
              shouldUpdateResumeFromServer = true;
              console.log(`[${new Date().toISOString()}] Checking server for newer resume...`);
              
              try {
                // Try to get resume from backend
                const response = await fetch(`${backendApiUrl}?action=getUserResumes&userId=${session.userId}&sessionToken=${session.sessionToken}`);
                const data = await response.json();
                
                if (data.success && data.resumes && data.resumes.length > 0) {
                  // Use the most recently updated resume
                  const mostRecentResume = data.resumes.sort((a, b) => 
                    new Date(b.lastUpdated) - new Date(a.lastUpdated)
                  )[0];
                  
                  console.log("Using resume from backend:", mostRecentResume.name);
                  
                  // Enhance local resume data with backend data
                  resumeData = {
                    ...resumeData,
                    backendId: mostRecentResume.id,
                    url: mostRecentResume.url,
                    downloadUrl: mostRecentResume.downloadUrl,
                    lastUpdated: mostRecentResume.lastUpdated
                  };
                  
                  // Update the local storage with the new resume data
                  chrome.storage.local.set({ 
                    resumeData: resumeData,
                    resumeLastServerCheck: now
                  });
                }
              } catch (error) {
                console.error("Error fetching resume from backend:", error);
                // Continue with local resume data
              }
            }
            
            // Call the AI API to analyze the form
            console.log(`[${new Date().toISOString()}] Calling AI API to analyze form...`);
            const aiDecision = await callGPT41API(
              formElements, 
              resumeData, 
              pageText,
              actionHistory || []
            );
            
            console.log(`[${new Date().toISOString()}] AI decision received, sending back to content script`);
            console.timeEnd('ai-analysis');
            
            // Send the AI's decision back to the content script
            sendResponse(aiDecision);
          });
        } catch (error) {
          console.error("Error checking for resume updates:", error);
          console.timeEnd('ai-analysis');
          // Fallback to using local resume data
          const aiDecision = await callGPT41API(
            formElements, 
            resumeData, 
            pageText,
            actionHistory || []
          );
          
          sendResponse(aiDecision);
        }
      } else {
        // Not logged in, use local data directly
        console.log(`[${new Date().toISOString()}] User not logged in, using local resume data`);
        const aiDecision = await callGPT41API(
          formElements, 
          resumeData, 
          pageText,
          actionHistory || []
        );
        
        sendResponse(aiDecision);
      }
    });
    
    return true; // Keep message channel open for async response
  }

  if (message.action === "generateCustomResumePreview") {
    (async () => {
      try {
        console.log(`[${new Date().toISOString()}] Resume Developer request received`);
        const context = await getResumeAndJobContext(message);
        const aiResult = await callResumeDeveloperModel(context);
        const persistence = await persistTailoredResumeAssets({
          ...aiResult,
          jobInfo: context.jobInfo
        });

        sendResponse({
          success: true,
          html: aiResult.htmlResume,
          highlights: aiResult.highlights,
          tailoringExplanations: aiResult.tailoringExplanations,
          meta: persistence.meta,
          rendererJob: persistence.queueItem
        });
      } catch (error) {
        console.error("Custom resume preview failed:", error);
        sendResponse({
          error: true,
          message: error?.message || "Failed to generate tailored resume"
        });
      }
    })();
    return true;
  }
  
  // Toggle auto-open popup setting
  if (message.action === "toggleAutoOpenPopup") {
    const enabled = message.enabled;
    chrome.storage.local.set({ autoOpenPopup: enabled }, () => {
      console.log(`Auto-open popup ${enabled ? 'enabled' : 'disabled'}`);
      sendResponse({ status: "success", autoOpenPopup: enabled });
    });
    return true;
  }
  
  // Get auto-open popup setting
  if (message.action === "getAutoOpenPopupSetting") {
    chrome.storage.local.get(['autoOpenPopup'], (result) => {
      const enabled = result.autoOpenPopup !== false; // Default to true if not set
      sendResponse({ autoOpenPopup: enabled });
    });
    return true;
  }
  
  if (message.action === "startAutofill") {
    // This is a direct autofill request from the popup
    console.log(`[${new Date().toISOString()}] Received startAutofill message from popup`);
    console.time('autofill-background-processing');
    
    // Use the existing startAutomation logic
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        console.log(`[${new Date().toISOString()}] Found active tab: ${tabs[0].url}`);
        // Check if content script is loaded, inject if needed
        const isLoaded = await isContentScriptLoaded(tabs[0].id);
        
        if (!isLoaded) {
          console.log(`[${new Date().toISOString()}] Content script not loaded, injecting...`);
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js']
            });
            console.log(`[${new Date().toISOString()}] Content script injected successfully`);
          } catch (err) {
            console.error("Error injecting content script:", err);
            sendResponse({ status: "error", message: "Could not inject content script" });
            console.timeEnd('autofill-background-processing');
            return;
          }
        } else {
          console.log(`[${new Date().toISOString()}] Content script already loaded`);
        }
        
        // Forward the autofill request to the content script
        console.log(`[${new Date().toISOString()}] Forwarding autofill request to content script`);
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'startAutofill',
          settings: {
            autoSubmit: false,
            detectOnly: false
          }
        }, (response) => {
          console.log(`[${new Date().toISOString()}] Received response from content script:`, response);
          console.timeEnd('autofill-background-processing');
          if (chrome.runtime.lastError) {
            console.error("Error starting autofill:", chrome.runtime.lastError);
            sendResponse({ status: "error", message: chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { status: "automation_started" });
          }
        });
      } else {
        console.error(`[${new Date().toISOString()}] No active tab found`);
        sendResponse({ status: "error", message: "No active tab found" });
        console.timeEnd('autofill-background-processing');
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  if (message.action === "checkResumeAvailability") {
    chrome.storage.local.get(['resumeData', 'resumeFileData', 'userSession'], async (result) => {
      // If we have a resume under any of our known keys, return it
      if (result.resumeData || result.resumeFileData) {
        sendResponse({ 
          available: true, 
          resumeData: result.resumeData || result.resumeFileData
        });
        return;
      }
      
      // If we're logged in but don't have a resume, try to get it from server
      if (result.userSession) {
        try {
          const response = await fetch(`${backendApiUrl}?action=getUserResumes&userId=${result.userSession.userId}&sessionToken=${result.userSession.sessionToken}`);
          const data = await response.json();
          
          if (data.success && data.resumes && data.resumes.length > 0) {
            // Use the most recently updated resume
            const mostRecentResume = data.resumes.sort((a, b) => 
              new Date(b.lastUpdated) - new Date(a.lastUpdated)
            )[0];
            
            console.log("Retrieved resume from server:", mostRecentResume.name);
            
            // Store resume data locally
            chrome.storage.local.set({
              resumeData: mostRecentResume,
              resumeName: mostRecentResume.name || 'resume.pdf',
              resumeType: mostRecentResume.contentType || 'application/pdf',
              resumeFile: mostRecentResume.content,
              resumeLastServerCheck: Date.now()
            });
            
            sendResponse({ 
              available: true, 
              resumeData: mostRecentResume 
            });
          } else {
            sendResponse({ available: false });
          }
        } catch (error) {
          console.error("Error checking resume availability from server:", error);
          sendResponse({ available: false, error: error.message });
        }
      } else {
        // Not logged in and no resume
        sendResponse({ available: false });
      }
    });
    return true;
  }
  
  // Update advanced settings  
  if (message.action === "updateAdvancedSettings") {
    chrome.storage.local.set({ 
      advancedSettings: message.settings 
    }, () => {
      console.log("Advanced settings updated in background");
      sendResponse({ status: "success" });
    });
    return true;
  }
  
  // Track application  
  if (message.action === "trackApplication") {
    console.log(`[${new Date().toISOString()}] Received trackApplication request`);
    
    // Get user session to authenticate the request
    chrome.storage.local.get(['userSession'], async (result) => {
      if (!result.userSession || !result.userSession.userId || !result.userSession.sessionToken) {
        console.error("Cannot track application: No valid session found");
        sendResponse({ success: false, error: "Not authenticated" });
        return;
      }
      
      const { userId, sessionToken } = result.userSession;
      const applicationData = message.application;
      
      try {
        const response = await fetch(backendApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'trackApplication',
            userId: userId,
            sessionToken: sessionToken,
            application: applicationData
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          console.log(`[${new Date().toISOString()}] Application tracked successfully:`, data.applicationId);
          sendResponse({ success: true, applicationId: data.applicationId });
        } else {
          console.error(`[${new Date().toISOString()}] Failed to track application:`, data.error);
          sendResponse({ success: false, error: data.error });
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error tracking application:`, error);
        sendResponse({ success: false, error: "Network error" });
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Rest of message handlers...
  if (message.action === 'auth:logout') {
    try {
      chrome.storage.local.remove([
        'currentCoverLetter', 'lastGeneratedCoverLetter', 'contextData',
        'resumeData', 'resumeFile', 'resumeFileData', 'resumeName', 'resumeType', 'resumeLastServerCheck',
        'tokenUsage', 'applicationHistory', 'recentApplications'
      ], () => sendResponse({ status: 'cleared' }));
    } catch (e) {
      sendResponse({ status: 'error', message: e.message });
    }
    return true;
  }
  
  return false; // No need for an async response by default
});

// Create context menu for quick actions
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "autoFillForm",
    title: "Auto-Fill This Form",
    contexts: ["page"]
  });
  
  chrome.contextMenus.create({
    id: "detectFields",
    title: "Detect Form Fields",
    contexts: ["page"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "autoFillForm") {
    chrome.tabs.sendMessage(tab.id, { 
      action: "startAutomation",
      settings: { detectOnly: false }
    });
  } else if (info.menuItemId === "detectFields") {
    chrome.tabs.sendMessage(tab.id, { 
      action: "startAutomation",
      settings: { detectOnly: true }
    });
  }
});

// Add this helper function to handle the actual automation start
function startAutomationProcess(message, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      sendResponse({ status: "error", message: "No active tab found" });
      return;
    }
    
    // Check if we can inject scripts (avoid chrome:// and other restricted URLs)
    const url = tabs[0].url;
    if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
      sendResponse({ status: "error", message: "Cannot run on browser system pages" });
      return;
    }
    
    // Check if content script is already loaded in the tab
    const isLoaded = await isContentScriptLoaded(tabs[0].id);
    
    if (!isLoaded) {
      // If not loaded, inject the content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        });
        console.log("Content script injected successfully");
      } catch (error) {
        console.error("Error injecting content script:", error);
        sendResponse({ status: "error", message: "Failed to inject content script" });
        return;
      }
    }
    
    // Now send the message to start automation
    try {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "startAutomation",
        settings: message.settings
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending message:", chrome.runtime.lastError);
          sendResponse({ status: "error", message: chrome.runtime.lastError.message });
        } else {
          sendResponse({ status: "automation_started" });
        }
      });
    } catch (error) {
      console.error("Error sending message to content script:", error);
      sendResponse({ status: "error", message: error.message });
    }
  });
}

// Helper function to get advanced settings from storage
function getAdvancedSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['advancedSettings'], (result) => {
      if (result.advancedSettings) {
        resolve(result.advancedSettings);
      } else {
        // Default settings if not found
        resolve({
          fillOptionalFields: true,
          enhancedJobMatching: true,
          autosaveApplications: false,
          aiPersonality: "Professional (Default)"
        });
      }
    });
  });
}
