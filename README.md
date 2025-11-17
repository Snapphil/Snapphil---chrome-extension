# SnapPhil Cover Letter Settings Implementation

This document summarizes the implementation of cover letter settings for the SnapPhil AI Job Application Assistant extension.

## Overview

Cover letter settings allow users to customize how the AI generates cover letters for job applications. Users can now:

1. Select a cover letter style:
   - Professional (Standard)
   - Creative & Bold
   - Academic & Formal
   - Concise & Direct

2. Toggle specific content features:
   - Include Specific Achievements: Highlights quantifiable results and achievements
   - Mention Company Research: Shows knowledge of the company and its mission
   - Include Salary Expectations: Mentions salary only if requested in job description

3. Set a custom closing statement that will override the AI-generated closing.

## Implementation Details

The cover letter settings are implemented across multiple files:

### 1. `settings/index.html`

- Added data attributes to form controls to identify settings
- Added unique IDs to form controls for easier JavaScript access
- Added IDs to save and reset buttons

### 2. `settings/script.js`

- Added cover letter settings to data loading tracking
- Implemented `loadCoverLetterSettings()` to load settings from storage
- Implemented `saveCoverLetterSettings()` to save settings to storage
- Added event listeners for save and reset buttons
- Settings are applied and stored in Chrome storage

### 3. `background.js`

- Added `getCoverLetterSettings()` helper function to retrieve settings
- Modified the AI prompt to include cover letter styling preferences
- Added detailed instructions to the AI on how to respect user preferences
- Added message handler for `updateCoverLetterSettings` action

### 4. `content.js`

- Enhanced cover letter processing to apply custom closing statements
- Added code to retrieve cover letter settings when generating a cover letter

## Usage

1. Users can navigate to the Cover Letter Settings tab in the extension settings
2. Adjust settings according to their preferences
3. Click "Save Changes" to apply the settings
4. When the AI generates a cover letter during the application process, it will respect these settings

The settings are stored using Chrome's storage API and are synchronized across all instances of the extension.

## Future Enhancements

Potential future enhancements could include:
- Additional cover letter templates/styles
- More granular control over cover letter sections
- Preview functionality for generated cover letters
- Option to save multiple cover letter templates 

## Resume Developer Preview

- The content script now injects a Resume Developer panel next to the Resume/CV upload widget on detected job boards.  
- Clicking the refresh icon reuses the stored resume text and freshly scraped job description to ask `gpt-5-mini` for ATS-safe HTML plus highlight bullets.  
- The HTML renders live in a sandboxed iframe while a renderer job is queued (see `scripts/renderResumeHtml.js`) to export PDF/DOCX assets into `tmp/resume-html/`.  
- Status chips show whether the preview is cached, regenerating, or failed so users know when a tailored resume is ready to upload.