## Resume Developer Flow

1. **Inputs**
   - Resume text is always pulled from `chrome.storage.local.resumeTextContent` (with `resumeData.textContent` as fallback) once the user uploads a file in the settings panel.
   - Job requirements are scraped from the active tab via `getPageText()` so headings, bullet lists, and descriptions are captured verbatim.

2. **Prompting the model**
   - `background.js` calls the same `gpt-5-mini` (or Cerebras fallback) endpoint used for autofill.
   - System (developer) message: instructs "Resume Developer" to emit JSON `{ htmlResume, highlights, tailoringExplanations, pdfFileName, theme }`, bans remote assets, and enforces ATS-safe HTML. The HTML template no longer includes the "What was tailored?" section; tailoring bullets live only in the UI.
   - The `tailoringExplanations` array contains detailed bullets explaining what was changed and why (e.g., "Removed AWS Lambda project because JD prioritizes GCP").
   - User message: embeds
     ```
     Role/company metadata
     """raw resume text"""
     """job requirements"""
     ```
     plus reminders to keep facts accurate and align bullets to the posting.

3. **Rendering**
   - The Responses payload returns HTML that is saved under `customResumePreview` in storage and queued for the Node renderer (`scripts/renderResumeHtml.js → renderResumeHtml(data)`).
   - Before display/download, `content.js` normalizes the markup (splits contact spans, removes strikethrough tags, renames "GENAI" to "GEN AI", strips the tailoring section) so ATS output stays consistent.
   - The content script displays the normalized HTML side-by-side with the job form inside a sandboxed `<iframe>` while the renderer sidecar can turn the same HTML into PDF/DOCX (`tmp/resume-html/*.pdf|docx`).

4. **Refresh loop**
   - The "Refresh" icon beside the Resume/CV section triggers `generateCustomResumePreview`:
     - Re-collects resume + job text.
     - Sends a new AI request.
     - Streams tailoring explanations back into the preview panel.

5. **Checklist**
   - [x] Resume text originates from the user upload pipeline (`completeFileProcessing`).
   - [x] Job description scraped from the visible posting whenever refresh runs.
   - [x] AI responds with ATS-safe HTML + summary highlights + tailoring explanations (UI only).
   - [x] HTML preview injected next to the Resume/CV widget plus renderer queue for PDF/DOCX.
   - [x] Normalization removes the tailoring section, enforces consistent headings, and keeps contact info readable across lines.

