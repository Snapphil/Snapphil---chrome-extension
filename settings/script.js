// Import PDF.js library as ES module
// Load pdf.js only where module context is allowed (settings page, not as a content script)
import * as pdfjsLib from '../lib/pdfjs/build/pdf.mjs';
// Global variables for authentication and session state
let isAuthenticated = false;
let userSession = null;
const backendApiUrl = "https://script.google.com/macros/s/AKfycbx51SIMS8LHseKPY907psklUCcZ6QqIayglzVLJnlQPBSFwQI1nwRKFdasDwLOmLliipQ/exec";

// Data loading tracking system
const dataLoading = {
  resume: false,
  applications: false,
  context: false,
  settings: false,
  coverLetterSettings: false,
  advancedSettings: false,
  userInfo: false,
  initialLoadComplete: false,
  startTime: null,
  supportQueries: false
};

// Lightweight caching layer for expensive sections
const CACHE_CONFIG = {
  applications: { key: 'cache_applications', ttl: 5 * 60 * 1000 },
  supportQueries: { key: 'cache_supportQueries', ttl: 10 * 60 * 1000 },
  coverLetterSettings: { key: 'cache_coverLetterSettings', ttl: 10 * 60 * 1000 }
};

function cacheSection(section, payload) {
  const config = CACHE_CONFIG[section];
  if (!config) return;
  chrome.storage.local.set({
    [config.key]: {
      payload,
      timestamp: Date.now(),
      userId: userSession?.userId || null
    }
  });
}

function getCachedSectionState(section) {
  const config = CACHE_CONFIG[section];
  if (!config) {
    return Promise.resolve({ payload: null, isFresh: false });
  }
  return new Promise(resolve => {
    chrome.storage.local.get([config.key], result => {
      const entry = result[config.key];
      if (!entry) {
        resolve({ payload: null, isFresh: false });
        return;
      }
      const belongsToUser = !entry.userId || !userSession?.userId || entry.userId === userSession.userId;
      if (!belongsToUser) {
        resolve({ payload: null, isFresh: false });
        return;
      }
      const isFresh = !!entry.timestamp && (Date.now() - entry.timestamp) < config.ttl;
      resolve({
        payload: entry.payload || null,
        isFresh,
        timestamp: entry.timestamp || 0
      });
    });
  });
}

function renderApplicationSkeleton(rows = 3) {
  const applicationList = document.querySelector('.recent-applications');
  if (!applicationList) return;
  let skeleton = '<div class="skeleton-stack">';
  for (let i = 0; i < rows; i++) {
    skeleton += `
      <div class="skeleton-card">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-chip-group">
          <span class="skeleton-chip w-30"></span>
          <span class="skeleton-chip w-20"></span>
          <span class="skeleton-chip w-25"></span>
        </div>
      </div>
    `;
  }
  skeleton += '</div>';
  applicationList.innerHTML = skeleton;
}

function renderSupportQueriesSkeleton(rows = 2) {
  const container = document.getElementById('support-queries-container');
  if (!container) return;
  let skeleton = '<div class="skeleton-stack">';
  for (let i = 0; i < rows; i++) {
    skeleton += `
      <div class="skeleton-card">
        <div class="skeleton-line w-80"></div>
        <div class="skeleton-line w-50"></div>
        <div class="skeleton-line w-70"></div>
      </div>
    `;
  }
  skeleton += '</div>';
  container.innerHTML = skeleton;
}

// --- Chrome Extension API Integration ---

// Send message to background script
function sendMessageToBackground(message, callback) {
  chrome.runtime.sendMessage(message, callback || function(response) {
    console.log("Message sent to background:", message);
    console.log("Response:", response);
  });
}

// Save data to Chrome storage
function saveToStorage(key, value, callback) {
  chrome.storage.local.set({ [key]: value }, callback || function() {
    console.log(`Saved to storage: ${key}`);
  });
}

// Get data from Chrome storage
function getFromStorage(key, callback) {
  chrome.storage.local.get(key, function(result) {
    if (callback) callback(result[key]);
  });
}

let loadingFailsafeTimer = null;

// Show loading overlay with specific configuration
function showLoading(type = 'general', tabId = null) {
  // Don't show loading if initial load is already complete (except for explicit user actions)
  if (dataLoading.initialLoadComplete && type !== 'saveContext') return;
  
  // Force show the loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('active');
    
    // Record start time for timing
    dataLoading.startTime = Date.now();
    
    // Set content based on loading type
    const loadingMessage = document.getElementById('loadingMessage');
    const loadingDescription = document.getElementById('loadingDescription');
    const loadingTime = document.getElementById('loadingTime');
    const loadingProgressBar = document.getElementById('loadingProgressBar');
    
    // Define loading configurations
    const loadingConfig = {
      'resume': {
        message: 'Loading Resume',
        description: 'We\'re retrieving your resume data from our servers.',
        estimatedTime: '3 seconds'
      },
      'applications': {
        message: 'Loading Applications',
        description: 'We\'re retrieving your application history.',
        estimatedTime: '3 seconds'
      },
      'context': {
        message: 'Loading Context',
        description: 'We\'re retrieving your personalized context data.',
        estimatedTime: '3 seconds'
      },
      'saveContext': {
        message: 'Saving Context',
        description: 'We\'re updating your personalized context data.',
        estimatedTime: '3 seconds'
      },
      'general': {
        message: 'Loading',
        description: 'We\'re retrieving data from our servers.',
        estimatedTime: '3 seconds'
      }
    };
    
    const config = loadingConfig[type] || loadingConfig['general'];
    if (loadingMessage) loadingMessage.textContent = config.message;
    if (loadingDescription) loadingDescription.textContent = config.description || 'Loading all your data...';
    
    // Get estimated time based on historical data
    const estimatedSeconds = getEstimatedLoadingTime();
    if (loadingTime) loadingTime.textContent = `Estimated time: ${estimatedSeconds} seconds`;
    
    // Reset progress bar
    if (loadingProgressBar) loadingProgressBar.style.width = '5%';
    
    // Animate progress bar
    animateProgressBar(estimatedSeconds * 1000); // Convert to milliseconds
    
    // Mark type as loading
    if (type in dataLoading) {
      dataLoading[type] = true;
    }
    // Schedule a dynamic failsafe to auto-hide if something stalls
    scheduleLoadingFailsafe();
  }
  
  return 'loadingOverlay';
}

// Hide loading overlay when all data is loaded
function hideLoading() {
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (!loadingOverlay) return;
  
  // Check if all data is loaded
  const stillLoading = Object.entries(dataLoading).filter(([key, value]) => 
    key !== 'initialLoadComplete' && key !== 'startTime' && value === true
  );
  
  if (stillLoading.length === 0) {
    // All data is loaded, hide the loading overlay
    loadingOverlay.classList.remove('active');
    dataLoading.initialLoadComplete = true;
    
    // Record the loading time for future reference
    recordLoadingTime();
    // Clear any scheduled failsafe
    if (loadingFailsafeTimer) {
      clearTimeout(loadingFailsafeTimer);
      loadingFailsafeTimer = null;
    }
  } else {
    console.log(`Still loading: ${stillLoading.map(i => i[0]).join(', ')}`);
  }
}

// Function to estimate loading time based on historical data
function getEstimatedLoadingTime() {
  try {
    // Try to get historical loading times from localStorage
    const loadingTimesStr = localStorage.getItem('loadingTimeHistory');
    if (loadingTimesStr) {
      const loadingTimes = JSON.parse(loadingTimesStr);
      
      // If we have historical data, calculate the average
      if (loadingTimes && loadingTimes.length > 0) {
        const sum = loadingTimes.reduce((acc, time) => acc + time, 0);
        const average = Math.round(sum / loadingTimes.length);
        
        // Return average in seconds, with minimum of 3 seconds
        return Math.max(3, Math.round(average / 1000));
      }
    }
    
    // If no data or error, return default value (7 seconds)
    return 7;
  } catch (error) {
    console.error("Error calculating estimated loading time:", error);
    return 7; // Default fallback
  }
}

// Function to record actual loading time
function recordLoadingTime() {
  if (!dataLoading.startTime) return;
  
  try {
    const endTime = Date.now();
    const loadTime = endTime - dataLoading.startTime;
    
    // Get existing records
    let loadingTimes = [];
    const loadingTimesStr = localStorage.getItem('loadingTimeHistory');
    
    if (loadingTimesStr) {
      loadingTimes = JSON.parse(loadingTimesStr);
    }
    
    // Add new time and keep only the last 10 records
    loadingTimes.push(loadTime);
    if (loadingTimes.length > 10) {
      loadingTimes = loadingTimes.slice(-10);
    }
    
    // Save back to localStorage
    localStorage.setItem('loadingTimeHistory', JSON.stringify(loadingTimes));
    console.log(`Recorded loading time: ${loadTime}ms, avg: ${loadingTimes.reduce((a, b) => a + b, 0) / loadingTimes.length}ms`);
  } catch (error) {
    console.error("Error recording loading time:", error);
  }
}

// Animate progress bar to simulate progress
function animateProgressBar(totalTime = 3000) {
  const loadingProgressBar = document.getElementById('loadingProgressBar');
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (!loadingProgressBar || !loadingOverlay) return;
  
  let width = 5;
  
  // Complete the progress bar in the estimated time
  const interval = 50; // Update every 50ms
  const steps = totalTime / interval;
  const increment = 95 / steps; // 95% remaining progress divided by steps
  
  const animation = setInterval(() => {
    if (width >= 100 || !loadingOverlay.classList.contains('active')) {
      clearInterval(animation);
    } else {
      width += increment;
      loadingProgressBar.style.width = Math.min(width, 100) + '%';
    }
  }, interval);
  
  return animation;
}

// Dynamically schedule a failsafe hide based on historical loading time
function scheduleLoadingFailsafe() {
  try {
    if (loadingFailsafeTimer) {
      clearTimeout(loadingFailsafeTimer);
      loadingFailsafeTimer = null;
    }
    const estimated = getEstimatedLoadingTime(); // in seconds
    // Add a cushion so we only hide if truly stuck
    const timeoutMs = Math.max(7000, (estimated + 5) * 1000);
    loadingFailsafeTimer = setTimeout(() => {
      const loadingOverlay = document.getElementById('loadingOverlay');
      if (loadingOverlay && loadingOverlay.classList.contains('active')) {
        loadingOverlay.classList.remove('active');
        loadingOverlay.style.opacity = 0;
        loadingOverlay.style.visibility = 'hidden';
        console.debug('[failsafe] Loading overlay auto-hidden after timeout');
      }
    }, timeoutMs);
  } catch (e) {
    // No-op
  }
}

// Mark a specific data type as loaded
function markDataLoaded(type) {
  if (type in dataLoading) {
    dataLoading[type] = false;
  }
  hideLoading();
}

// Show status notification
function showStatus(message, type = 'info') {
  // Send status message to the active tab
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs && tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'showNotification',
        message: message,
        type: type
      }).catch(error => {
        console.log("Could not send notification to content script", error);
        
        // Fallback: Show toast notification in the popup
        showToastNotification(message, type);
      });
    } else {
      // Fallback: Show toast notification in the popup
      showToastNotification(message, type);
    }
  });
}

// Fallback toast notification in the popup
function showToastNotification(message, type = 'info') {
  // Check if toast element exists, create if not
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  // Set message and type
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  
  // Show toast
  setTimeout(() => {
    toast.classList.add('show');
    
    // Hide after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }, 100);
}

// --- Step 5: Progress Tracking Functions ---
function showProgressWindow(show = true) {
  const progressWindow = document.getElementById('progressWindow');
  if (!progressWindow) return;
  if (show) {
    progressWindow.classList.remove('hidden');
    progressWindow.classList.remove('collapsed');
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercentage').textContent = '0%';
    document.getElementById('currentAction').textContent = 'Initializing...';
    document.getElementById('progressLog').innerHTML = '';
    if (document.getElementById('collapseProgressBtn')) {
      document.getElementById('collapseProgressBtn').innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
  } else {
    progressWindow.classList.add('hidden');
  }
}

function updateProgress(percent, action, message, type = 'info') {
  const progressFill = document.getElementById('progressFill');
  const progressPercentage = document.getElementById('progressPercentage');
  const currentAction = document.getElementById('currentAction');
  const progressLog = document.getElementById('progressLog');
  if (!progressFill || !progressPercentage || !currentAction || !progressLog) return;
  progressFill.style.width = `${percent}%`;
  progressPercentage.textContent = `${percent}%`;
  if (action) currentAction.textContent = action;
  if (message) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    progressLog.insertBefore(logEntry, progressLog.firstChild);
  }
}

function resetStatusCards() {
  document.querySelectorAll('.status-card-mini').forEach(card => {
    card.classList.remove('active', 'completed', 'error');
  });
}

function updateStatusCards(statusId, type = 'info') {
  const statuses = ['init', 'detect', 'analyze', 'fill', 'submit'];
  const statusIndex = statuses.indexOf(statusId);
  document.querySelectorAll('.status-card-mini').forEach(card => {
    const cardIndex = statuses.indexOf(card.dataset.id);
    if (card.dataset.id === statusId) {
      card.classList.add('active');
      if (type === 'error') card.classList.add('error');
    } else if (cardIndex < statusIndex) {
      card.classList.add('completed');
      card.classList.remove('active', 'error');
    }
  });
}

// --- Step 6: PDF Processing Implementation ---
function initFileUpload() {
  console.log("[DEBUG] initFileUpload called for new ResumeUploadCard");

  const emptyState = document.getElementById('emptyState');
  const fileInfoBar = document.getElementById('fileInfoBar');
  const fileInput = document.getElementById('resume-file-input');
  const browseButton = document.getElementById('browseButton');
  const replaceButton = document.getElementById('replaceButton');
  const replaceFileInput = document.getElementById('replace-file-input');
  const downloadLink = document.getElementById('downloadLink');

  if (!emptyState || !fileInfoBar || !fileInput) {
    console.error("[initFileUpload] Error: Required elements not found!");
    return;
  }

  // Initialize state based on existing resume data
  checkExistingResume();

  // Browse button click handler
  browseButton?.addEventListener('click', function(e) {
    e.stopPropagation();
    console.log("[initFileUpload] Browse button clicked");
    fileInput.click();
  });

  // Empty state click handler (for entire area)
  emptyState.addEventListener('click', function(e) {
    // Only trigger if clicking the area itself, not the button
    if (e.target === emptyState || e.target.closest('.upload-icon') || e.target.closest('.upload-label')) {
      console.log("[initFileUpload] Empty state area clicked");
      fileInput.click();
    }
  });

  // File input change handler
  fileInput.addEventListener('change', function(e) {
    console.log("[initFileUpload] File selected via browse:", e.target.files[0]);
    if (this.files && this.files[0]) {
      processUploadedFile(this.files[0]);
    }
  });

  // Replace button click handler
  replaceButton?.addEventListener('click', function(e) {
    e.stopPropagation();
    console.log("[initFileUpload] Replace button clicked");
    replaceFileInput.click();
  });

  // Replace file input change handler
  replaceFileInput?.addEventListener('change', function(e) {
    console.log("[initFileUpload] File selected for replacement:", e.target.files[0]);
    if (this.files && this.files[0]) {
      processUploadedFile(this.files[0]);
    }
  });

  // Drag and drop functionality for empty state
  emptyState.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.style.background = 'rgba(50, 50, 50, 0.5)';
    this.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    console.log("[initFileUpload] Dragging file over empty state");
  });

  emptyState.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only reset if actually leaving the element (not entering a child)
    if (!this.contains(e.relatedTarget)) {
      this.style.background = '';
      this.style.borderColor = '';
      console.log("[initFileUpload] Drag leave empty state");
    }
  });

  emptyState.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.style.background = '';
    this.style.borderColor = '';
    console.log("[initFileUpload] File dropped on empty state:", e.dataTransfer.files[0]);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  });

  // Keyboard accessibility for browse button
  browseButton?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Keyboard accessibility for replace button
  replaceButton?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      replaceFileInput.click();
    }
  });
}

function checkExistingResume() {
  // Check Chrome storage for existing resume data
  chrome.storage.local.get(['resumeData', 'resumeFileData'], function(result) {
    const resumeData = result.resumeData || result.resumeFileData;
    
    if (resumeData && resumeData.fileName) {
      console.log("[checkExistingResume] Found existing resume:", resumeData.fileName);
      showFileInfoBar(resumeData);
    } else {
      console.log("[checkExistingResume] No existing resume found, showing empty state");
      showEmptyState();
    }
  });
}

function showEmptyState() {
  const emptyState = document.getElementById('emptyState');
  const fileInfoBar = document.getElementById('fileInfoBar');
  
  if (emptyState && fileInfoBar) {
    emptyState.style.display = 'flex';
    fileInfoBar.style.display = 'none';
    console.log("[showEmptyState] Switched to empty state");
  }
}

function showFileInfoBar(resumeData) {
  console.log("[DEBUG] showFileInfoBar called with:", resumeData);
  
  const emptyState = document.getElementById('emptyState');
  const fileInfoBar = document.getElementById('fileInfoBar');
  const fileName = document.getElementById('fileName');
  const fileMeta = document.getElementById('fileMeta');
  const downloadLink = document.getElementById('downloadLink');
  
  if (!fileInfoBar || !fileName || !fileMeta || !downloadLink) {
    console.error("[ERROR] File info bar elements not found");
    return;
  }
  
  // Hide empty state and show file info bar
  if (emptyState) emptyState.style.display = 'none';
  fileInfoBar.style.display = 'flex';
  
  // Update file info
  fileName.textContent = truncateFileName(resumeData.name || resumeData.fileName || 'resume.pdf', 30);
  fileMeta.textContent = `Last uploaded: ${formatUploadDate(resumeData.uploadedAt || resumeData.uploadDate)}`;
  
  // Set download link
  if (resumeData.url || resumeData.downloadUrl) {
    downloadLink.href = resumeData.url || resumeData.downloadUrl;
    downloadLink.download = resumeData.name || resumeData.fileName || 'resume.pdf';
    downloadLink.style.display = 'inline-flex';
  } else {
    downloadLink.style.display = 'none';
  }
  
  console.log("[DEBUG] File info bar updated successfully");
}

function truncateFileName(fileName, maxLength) {
  if (fileName.length <= maxLength) return fileName;
  
  const extension = fileName.split('.').pop();
  const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
  const maxNameLength = maxLength - extension.length - 4; // Account for "..." and "."
  
  if (nameWithoutExt.length <= maxNameLength) return fileName;
  
  const start = nameWithoutExt.substring(0, Math.floor(maxNameLength / 2));
  const end = nameWithoutExt.substring(nameWithoutExt.length - Math.floor(maxNameLength / 2));
  
  return `${start}...${end}.${extension}`;
}

function formatUploadDate(dateString) {
  const uploadDate = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - uploadDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 1) return 'Today';
  if (diffDays === 2) return 'Yesterday';
  if (diffDays <= 7) return `${diffDays - 1} days ago`;
  
  return uploadDate.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: uploadDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function showUploadProgress() {
  const progressOverlay = document.getElementById('uploadProgressOverlay');
  const progressBar = document.getElementById('uploadProgressBar');
  
  if (progressOverlay && progressBar) {
    progressOverlay.style.display = 'flex';
    progressBar.style.animation = 'progress-pulse 2s ease-in-out';
    
    // Hide after 2 seconds
    setTimeout(() => {
      hideUploadProgress();
    }, 2000);
  }
}

function hideUploadProgress() {
  const progressOverlay = document.getElementById('uploadProgressOverlay');
  
  if (progressOverlay) {
    progressOverlay.style.display = 'none';
  }
}

function processUploadedFile(file) {
  if (!file) {
    console.error("[processUploadedFile] No file provided");
    return;
  }
  
  console.log("[DEBUG] processUploadedFile called with:", file.name, file.type, file.size);
  
  // Show upload progress bar
  showUploadProgress();
  
  if (file.type === 'application/pdf') {
    extractTextFromPDF(file);
  } else {
    // For other file types, simulate processing
    simulateProcessing(file);
  }
}

function extractTextFromPDF(file) {
  console.log("[extractTextFromPDF] called with", file);

  // ------- 1.  Tell pdf-js where its worker lives  -------------------- //
  if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    // Use the non-module worker file to avoid import.meta in MV3 service/content contexts
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/build/pdf.worker.js');
    console.log("[extractTextFromPDF] workerSrc set →", pdfjsLib.GlobalWorkerOptions.workerSrc);
  }

  // ------- 2.  Read the file as ArrayBuffer  -------------------- //
  const reader = new FileReader();
  reader.onload = e => {
    const pdfData = e.target.result;
    console.log("[extractTextFromPDF] File read → launching pdf-js…");

    // NOTE: don't pass disableWorker:true – we have a worker now
    pdfjsLib.getDocument({ data: pdfData }).promise
      .then(pdf => {
        console.log("[extractTextFromPDF] PDF loaded – pages:", pdf.numPages);
        return Promise.all(
          [...Array(pdf.numPages).keys()].map(i =>
            pdf.getPage(i + 1).then(p => p.getTextContent())
          )
        );
      })
      .then(pages => {
        const fullText = pages
          .map(tc => tc.items.map(it => it.str).join(' '))
          .join('\n\n');
        console.log("[extractTextFromPDF] extraction done, length:", fullText.length);
        completeFileProcessing(file.name, fullText);
      })
      .catch(err => {
        console.error("[extractTextFromPDF] pdf-js error:", err);
        showStatus("Error processing PDF", "error");
        document.querySelector('.parsing-indicator')?.classList.remove('visible');
      });
  };
  reader.onerror = err => console.error("[extractTextFromPDF] FileReader error:", err);

  reader.readAsArrayBuffer(file);
}




function simulateProcessing(file) {
  const extractionStatus = document.getElementById('extraction-status');
  if (extractionStatus) {
    setTimeout(() => {
      extractionStatus.textContent = '• Extracting work experience';
      setTimeout(() => {
        extractionStatus.textContent = '• Identifying skills and qualifications';
        setTimeout(() => {
          extractionStatus.textContent = '• Analyzing education history';
          setTimeout(() => {
            completeFileProcessing(file.name, "Simulated text content");
          }, 500);
        }, 500);
      }, 500);
    }, 500);
  }
}

function completeFileProcessing(fileName, textContent) {
  // Get the file content from the stored upload data
  chrome.storage.local.get('tempFileData', function(tempResult) {
    const base64Content = tempResult.tempFileData ? tempResult.tempFileData.content : "";
    const fileType = tempResult.tempFileData ? tempResult.tempFileData.fileType : "application/pdf";
    
    // Save to Chrome storage with ALL required keys for consistency
    const resumeObject = { 
      fileName: fileName, 
      textContent: textContent, 
      uploadDate: new Date().toISOString(),
      content: base64Content,
      fileType: fileType
    };

    chrome.storage.local.set({ 
      'resumeFileData': resumeObject,
      'resumeTextContent': textContent,   // Save plain text separately for .txt download
      'resumeData': resumeObject,         // Primary resume data key
      'resumeFile': base64Content,        // Base64 content for autofill
      'resumeName': fileName,             // File name for autofill
      'resumeType': fileType              // File type for autofill
    }, function() {
      console.log('Resume file data and text content saved to all Chrome storage keys.');
      
      // Also save to localStorage for better state sharing between components
      try {
        localStorage.setItem('resumeData', JSON.stringify(resumeObject));
        console.log('Resume data also saved to localStorage');
      } catch (e) {
        console.error('Error saving to localStorage:', e);
      }
      
      // Update the UI to show the file info bar
      showFileInfoBar(resumeObject);
    });

    sendMessageToBackground(
      { action: "updateResume", resumeData: resumeObject },
      () => {
        // put any follow-up logic here if you really need it
      }
    );

    // Update legacy UI elements if they exist (for backward compatibility)
    const extractionStatus = document.getElementById('extraction-status');
    const parsedStatus = document.getElementById('parsed-status');
    const successCheck = document.getElementById('success-check');
    const successPulse = document.getElementById('success-pulse');
    const parsingIndicator = document.querySelector('.parsing-indicator');
    const uploadStatus = document.getElementById('upload-status');

    if (extractionStatus) extractionStatus.style.display = 'none';
    if (parsedStatus) parsedStatus.style.display = 'block';
    if (uploadStatus) uploadStatus.classList.add('parsed');
    if (successPulse) successPulse.classList.add('animate');
    if (successCheck) successCheck.classList.add('visible');
    if (parsingIndicator) parsingIndicator.classList.remove('visible');

    // Save parsed text as downloadable .txt file
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.[^/.]+$/, "") + "_parsed.txt"; // original name with _parsed.txt
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus("Resume processed successfully", "success");

    // If authenticated, upload resume to server
    if (isAuthenticated && userSession) {
      validateSession(userSession).then(() => {
        uploadResumeToServer(resumeObject);
      }).catch(() => {
        showStatus("Session expired. Please log in again to upload.", "warning");
      });
    }
    
    // Clean up temp data
    chrome.storage.local.remove('tempFileData');
  });
}

function uploadResumeToServer(resumeData) {
  if (!isAuthenticated || !userSession?.userId || !userSession?.sessionToken) {
    showStatus("Cannot upload: Not authenticated. Please sign in.", "error");
    return;
  }

  showStatus("Uploading resume to server...", "progress");

  chrome.storage.local.get('resumeFileData', function(result) {
    if (!result || !result.resumeFileData) {
      showStatus("Error: Resume data not found in storage", "error");
      return;
    }

    const fileData = result.resumeFileData;

    fetch(`${backendApiUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadResume',
        userId: userSession.userId,
        sessionToken: userSession.sessionToken,
        fileData: fileData.content || "",
        fileName: fileData.fileName || resumeData.fileName,
        contentType: fileData.fileType || "application/pdf",
        textContent: fileData.textContent || resumeData.textContent
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showStatus("Resume uploaded to server successfully", "success");

        if (!userSession.userContext) userSession.userContext = {};

        const enhancedResumeData = {
          ...resumeData,
          url: data.url,
          downloadUrl: data.downloadUrl,
          fileId: data.fileId,
          resumeId: data.resumeId,
          content: fileData.content || "",  // Ensure base64 content is preserved
          fileName: fileData.fileName || resumeData.fileName,
          fileType: fileData.fileType || "application/pdf"
        };

        userSession.userContext.resume = enhancedResumeData;

        // Save to ALL storage keys that autofill expects
        chrome.storage.local.set({
          resumeData: enhancedResumeData,
          resumeFileData: enhancedResumeData,
          resumeFile: fileData.content || "",  // Base64 content for autofill
          resumeName: fileData.fileName || resumeData.fileName,
          resumeType: fileData.fileType || "application/pdf",
          resumeTextContent: fileData.textContent || resumeData.textContent
        }, function() {
          console.log('Enhanced resume data saved to all storage keys');
        });

        // Also save to localStorage for better state sharing
        try {
          localStorage.setItem('resumeData', JSON.stringify(enhancedResumeData));
          console.log('Enhanced resume data saved to localStorage');
        } catch (e) {
          console.error('Error saving to localStorage:', e);
        }

        sendMessageToBackground({
          action: "setUserSession",
          session: userSession
        });
        
        // Update the UI with the enhanced resume data
        showFileInfoBar(enhancedResumeData);
      } else {
        showStatus("Error uploading to server: " + (data.error || "Unknown server error"), "error");
      }
    })
    .catch(error => {
      console.error("Upload error:", error);
      showStatus("Error uploading to server: " + error.toString(), "error");
    });
  });
}


// --- Step 7: Auto-fill Implementation ---
function startAutofill() {
  showStatus("Starting automation...", "progress");
  showProgressWindow(true);
  updateProgress(0, "Initializing AI...", "Starting form autofill process");
  resetStatusCards();
  updateStatusCards("init");
  sendMessageToBackground({
    action: "startAutomation",
    settings: {
      autoSubmit: document.querySelector('#autoSubmitCheckbox')?.checked || false,
      detectOnly: false
    }
  }, function(response) {
    if (!response) {
      showStatus("No response from extension", "error");
      updateProgress(0, "Error initializing", "No response from extension", "error");
      updateStatusCards("init", "error");
      return;
    }
    if (response.status === "error") {
      showStatus("Error: " + response.message, "error");
      updateProgress(0, "Error initializing", "Error: " + response.message, "error");
      updateStatusCards("init", "error");
    } else if (response.status === "automation_started") {
      showStatus("Automation started", "progress");
      updateProgress(5, "AI analyzing form...", "Form analysis started", "info");
      updateStatusCards("init");
    }
  });
}

// --- Step 8: Application History ---
async function loadApplicationHistory(forceRefresh = false) {
  const applicationList = document.querySelector('.recent-applications');
  if (!isAuthenticated || !userSession) {
    if (applicationList) {
      applicationList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-clipboard-list"></i>
          <p>Please sign in to view your applications.</p>
        </div>
      `;
    }
    markDataLoaded('applications');
    return;
  }
  
  dataLoading.applications = true;
  renderApplicationSkeleton();
  
  const cachedState = await getCachedSectionState('applications');
  if (cachedState.payload && cachedState.payload.length) {
    updateApplicationsList(cachedState.payload);
    updateApplicationStats(cachedState.payload);
  }
  
  // Release the global loading overlay immediately after we have something to render
  markDataLoaded('applications');
  
  if (!forceRefresh && cachedState.isFresh) {
    console.log("Using cached application history");
    return;
  }
  
  try {
    const response = await fetch(`${backendApiUrl}?action=getUserApplications&userId=${userSession.userId}&sessionToken=${userSession.sessionToken}`);
    const data = await response.json();
    if (data.success) {
      const apps = data.applications || [];
      updateApplicationsList(apps);
      updateApplicationStats(apps);
      cacheSection('applications', apps);
    } else {
      console.error("Error loading application history:", data.error);
      showStatus("Error loading application history: " + data.error, "error");
    }
  } catch (error) {
    console.error("Error loading application history:", error);
    if (!cachedState.payload) {
      showStatus("Error loading application history", "error");
    }
  }
}

function updateApplicationsList(applications) {
  const applicationList = document.querySelector('.recent-applications');
  if (!applicationList) return;
  
  applicationList.innerHTML = '';
  
  if (!applications || applications.length === 0) {
    applicationList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clipboard-list"></i>
        <p>No applications tracked yet.</p>
      </div>
    `;
    return;
  }
  
  const recentApps = applications
    .sort((a, b) => new Date(b.appliedDate || b.date || b.timestamp) - new Date(a.appliedDate || a.date || a.timestamp))
    .slice(0, 5);
  
  recentApps.forEach(app => {
    const appItem = document.createElement('div');
    appItem.className = 'application-item';
    
    const statusClass = app.status === 'interview' ? 'status-interview' : 
                        app.status === 'offer' ? 'status-offer' : 
                        app.status === 'rejected' ? 'status-rejected' : 'status-applied';
    
    // Format date and time
    const appliedDate = new Date(app.appliedDate || app.date || app.timestamp);
    const dateFormatted = appliedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const timeFormatted = appliedDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    // Create URL actions HTML
    let urlActionsHtml = '';
    
    if (app.url) {
      urlActionsHtml += `
        <button class="action-btn app-url-btn" data-url="${app.url}" title="View Job Posting">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>`;
    }
    
    if (app.resume && app.resume.downloadUrl) {
      urlActionsHtml += `
        <button class="action-btn resume-download-btn" data-url="${app.resume.downloadUrl}" title="Download Resume">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
        </button>`;
    }
    
    if (app.coverLetter && app.coverLetter.downloadUrl) {
      urlActionsHtml += `
        <button class="action-btn coverletter-download-btn" data-url="${app.coverLetter.downloadUrl}" title="Download Cover Letter">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M4 6h16M4 12h16M4 18h7"></path>
          </svg>
        </button>`;
    }
    
    appItem.innerHTML = `
      <div class="application-card">
        <div class="application-header">
          <div class="application-status">
            <span class="status-dot ${statusClass}"></span>
            <span class="status-text">${app.status || 'applied'}</span>
          </div>
          <div class="application-actions">
            ${urlActionsHtml}
            <select class="status-dropdown" data-id="${app.id}" title="Update Status">
              <option value="applied" ${(app.status || 'applied') === 'applied' ? 'selected' : ''}>Applied</option>
              <option value="interview" ${app.status === 'interview' ? 'selected' : ''}>Interview</option>
              <option value="offer" ${app.status === 'offer' ? 'selected' : ''}>Offer</option>
              <option value="rejected" ${app.status === 'rejected' ? 'selected' : ''}>Rejected</option>
            </select>
          </div>
        </div>
        <div class="application-content">
          <h3 class="application-title">${app.jobTitle || 'Unknown Position'}</h3>
          <div class="application-company">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            <span>${app.company || 'Unknown Company'}</span>
          </div>
          <div class="application-meta">
            <div class="application-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>${dateFormatted}</span>
            </div>
            <div class="application-time">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>${timeFormatted}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    applicationList.appendChild(appItem);
  });
  
  // Add event listeners for URL buttons
  document.querySelectorAll('.app-url-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      if (url) {
        chrome.tabs.create({ url: url });
      }
    });
  });
  
  document.querySelectorAll('.resume-download-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      if (url) {
        chrome.tabs.create({ url: url });
      }
    });
  });
  
  document.querySelectorAll('.coverletter-download-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      if (url) {
        chrome.tabs.create({ url: url });
      }
    });
  });
  
  // Add event listeners for status update buttons
  document.querySelectorAll('.status-dropdown').forEach(btn => {
    console.log("Adding event listener to status update button:", btn);
    btn.addEventListener('change', function(e) {
      console.log("Status update button clicked!", this);
      e.preventDefault();
      e.stopPropagation();
      const applicationId = this.getAttribute('data-id');
      console.log("Application ID:", applicationId);
      if (applicationId) {
        // Use the dropdown value directly instead of showing modal
        const newStatus = this.value;
        
        console.log("Application ID:", applicationId, "New Status:", newStatus);
        
        if (newStatus) {
          // Disable dropdown during update
          this.disabled = true;
          
          // Call update function
          updateApplicationStatus(applicationId, newStatus)
            .then(() => {
              console.log("Status updated successfully");
              // Re-enable dropdown
              this.disabled = false;
            })
            .catch((error) => {
              console.error("Error updating status:", error);
              // Re-enable dropdown and revert to previous value
              this.disabled = false;
              // Revert to previous selection
              loadApplicationHistory(); // This will refresh and restore correct values
              showStatus("Error updating status: " + error.toString(), "error");
            });
        }
      } else {
        console.error("No application ID found on button");
      }
    });
  });
}

function updateApplicationStatus(applicationId, newStatus) {
  if (!isAuthenticated || !userSession) {
    const error = "Please sign in to update application status";
    showStatus(error, "error");
    return Promise.reject(new Error(error));
  }
  
  console.log("Updating application status:", applicationId, "to", newStatus);
  showStatus("Updating application status...", "progress");
  
  return fetch(`${backendApiUrl}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'updateApplicationStatus',
      userId: userSession.userId,
      sessionToken: userSession.sessionToken,
      applicationId: applicationId,
      status: newStatus
    })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    console.log("Update response:", data);
    
    if (data.success) {
      showStatus("Application status updated successfully", "success");
      // Reload application history to reflect changes
      loadApplicationHistory();
      return data;
    } else {
      const error = data.error || "Unknown error occurred";
      showStatus("Error updating application status: " + error, "error");
      throw new Error(error);
    }
  })
  .catch(error => {
    console.error("Error updating application status:", error);
    const errorMessage = error.message || error.toString();
    showStatus("Error updating application status: " + errorMessage, "error");
    throw error;
  });
}

function updateApplicationStats(applications) {
  const stats = { applied: 0, interview: 0, offer: 0, rejected: 0 };
  if (Array.isArray(applications)) {
    applications.forEach(app => {
      const status = app.status || 'applied';
      stats[status] = (stats[status] || 0) + 1;
    });
  }
  const appliedStatEl = document.querySelector('.stat-card:nth-child(1) .stat-value');
  const interviewStatEl = document.querySelector('.stat-card:nth-child(2) .stat-value');
  const offerStatEl = document.querySelector('.stat-card:nth-child(3) .stat-value');
  if (appliedStatEl) appliedStatEl.textContent = stats.applied;
  if (interviewStatEl) interviewStatEl.textContent = stats.interview;
  if (offerStatEl) offerStatEl.textContent = stats.offer;
  const totalApps = Object.values(stats).reduce((a, b) => a + b, 0);
  const limitBadge = document.querySelector('.limit-badge');
  const limitProgress = document.querySelector('.limit-progress');
  const dailyLimit = userSession?.dailyLimit || 20;
  const percent = Math.min(100, Math.round((totalApps / dailyLimit) * 100));
  if (limitBadge) limitBadge.textContent = `${percent}%`;
  if (limitProgress) limitProgress.style.width = `${percent}%`;
  
  // Update limit text
  const limitText = document.querySelector('.limit-text');
  if (limitText) {
    const usedApps = document.querySelector('.limit-text span:first-child');
    const availableApps = document.querySelector('.limit-text span:last-child');
    
    if (usedApps) {
      usedApps.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <path d="M5 12h14"></path>
          <path d="M12 5v14"></path>
        </svg>
        ${totalApps} applications used today
      `;
    }
    
    if (availableApps) {
      availableApps.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        ${dailyLimit - totalApps} applications available
      `;
    }
  }
}

// --- Step 9: Context Data Management ---
function saveContext() {
  const contextInput = document.querySelector('.context-input');
  if (!contextInput) return;
  
  const contextText = contextInput.value;
  
  // If not authenticated, save to local storage only
  if (!isAuthenticated || !userSession) {
    chrome.storage.local.set({ 'contextData': { additionalContext: contextText } }, function() {
      showStatus("Context saved locally", "success");
    });
    return;
  }
  
  // If authenticated, save to server and update local session
  showLoading('saveContext');
  fetch(`${backendApiUrl}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'updateUserContext',
      userId: userSession.userId,
      sessionToken: userSession.sessionToken,
      contextData: {
        additionalContext: contextText,
        updatedAt: new Date().toISOString()
      }
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      showStatus("Context saved successfully", "success");
      if (!userSession.userContext) {
        userSession.userContext = {};
      }
      userSession.userContext.additionalContext = contextText;
      sendMessageToBackground({ 
        action: "setUserSession", 
        session: userSession 
      });
    } else {
      showStatus("Error saving context: " + (data.error || "Unknown error"), "error");
    }
    hideLoading();
  })
  .catch(error => {
    showStatus("Error saving context: " + error.message, "error");
    hideLoading();
  });
}

function loadContextData() {
  dataLoading.context = true;
  const contextInput = document.querySelector('.context-input');
  if (!contextInput) {
    markDataLoaded('context');
    return;
  }
  
  // Try to get context from user session first
  if (isAuthenticated && userSession && userSession.userContext && userSession.userContext.additionalContext) {
    contextInput.value = userSession.userContext.additionalContext;
  } else {
    // Fall back to local storage
    chrome.storage.local.get(['contextData'], function(result) {
      if (result.contextData && result.contextData.additionalContext) {
        contextInput.value = result.contextData.additionalContext;
      }
      
      // Update character count
      const charCount = document.getElementById('char-count');
      if (charCount) {
        charCount.textContent = contextInput.value.length;
        if (contextInput.value.length > 400) {
          charCount.style.color = 'rgba(255, 180, 0, 0.8)';
        } else if (contextInput.value.length > 480) {
          charCount.style.color = 'rgba(255, 100, 100, 0.8)';
        }
      }
      
      markDataLoaded('context');
    });
    return;
  }
  
  // Update character count if we loaded from user session
  const charCount = document.getElementById('char-count');
  if (charCount) {
    charCount.textContent = contextInput.value.length;
    if (contextInput.value.length > 400) {
      charCount.style.color = 'rgba(255, 180, 0, 0.8)';
    } else if (contextInput.value.length > 480) {
      charCount.style.color = 'rgba(255, 100, 100, 0.8)';
    }
  }
  
  markDataLoaded('context');
}

// --- Step 10: Event Listeners Setup ---
function setupEventListeners() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
      // Get the tab ID from data attribute
      const tabId = this.getAttribute('data-tab');
      
      // Remove active class from all tabs and items
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      
      // Add active class to clicked item and corresponding tab
      this.classList.add('active');
      const tabContent = document.getElementById(tabId);
      if (tabContent) tabContent.classList.add('active');
      
      if (tabId === 'help' && isAuthenticated) {
        loadSupportQueries();
      }
    });
  });
  
  // Welcome and onboarding flow handlers
  document.getElementById('continueToTermsBtn')?.addEventListener('click', function() {
    document.getElementById('welcomePage')?.classList.remove('active-panel');
    document.getElementById('termsPage')?.classList.add('active-panel');
  });
  
  document.getElementById('acceptTermsBtn')?.addEventListener('click', function() {
    document.getElementById('termsPage')?.classList.remove('active-panel');
    document.getElementById('signupPage')?.classList.add('active-panel');
  });
  
  document.getElementById('declineTermsBtn')?.addEventListener('click', function() {
    document.getElementById('termsPage')?.classList.remove('active-panel');
    document.getElementById('welcomePage')?.classList.add('active-panel');
  });
  
  document.getElementById('backToTermsBtn')?.addEventListener('click', function() {
    document.getElementById('signupPage')?.classList.remove('active-panel');
    document.getElementById('termsPage')?.classList.add('active-panel');
  });
  
  // Authentication handlers - Login
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function(event) {
      event.preventDefault();
      loginUser();
    });
  }
  
  // Authentication handlers - Register
    const createAccountBtn = document.getElementById('createAccountBtn');
  if (createAccountBtn) {
    createAccountBtn.addEventListener('click', function(event) {
      event.preventDefault();
      createAccount();
    });
  }
  
  // Show Login Form
  const showLoginBtn = document.getElementById('showLoginBtn');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', function() {
      document.getElementById('signupPage')?.classList.remove('active-panel');
      document.getElementById('loginPage')?.classList.add('active-panel');
    });
  }
  
  // Show Signup Form
  const showSignupBtn = document.getElementById('showSignupBtn');
  if (showSignupBtn) {
    showSignupBtn.addEventListener('click', function() {
      document.getElementById('loginPage')?.classList.remove('active-panel');
      document.getElementById('signupPage')?.classList.add('active-panel');
    });
  }
  
  // Back to Signup from Login
  const backToSignupBtn = document.getElementById('backToSignupBtn');
  if (backToSignupBtn) {
    backToSignupBtn.addEventListener('click', function() {
      document.getElementById('loginPage')?.classList.remove('active-panel');
      document.getElementById('signupPage')?.classList.add('active-panel');
    });
  }
  
  // Logout handler
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      logout();
    });
  }

  document.querySelector('.personal-info-toggle')?.addEventListener('click', function() {
    const fields = document.querySelector('.personal-info-fields');
    const chevron = this.querySelector('.chevron');
    if (fields && chevron) {
      fields.classList.toggle('expanded');
      chevron.classList.toggle('down');
    }
  });
  
  document.getElementById('collapseProgressBtn')?.addEventListener('click', function() {
    document.getElementById('progressWindow')?.classList.toggle('collapsed');
    this.innerHTML = document.getElementById('progressWindow')?.classList.contains('collapsed')
      ? '<i class="fas fa-chevron-up"></i>'
      : '<i class="fas fa-chevron-down"></i>';
  });
  
  document.getElementById('closeProgressBtn')?.addEventListener('click', function() {
    document.getElementById('progressWindow')?.classList.add('hidden');
  });

  // Cover letter settings save button
  const coverLetterSaveBtn = document.getElementById('saveCoverLetterBtn');
  if (coverLetterSaveBtn) {
    coverLetterSaveBtn.addEventListener('click', function() {
      saveCoverLetterSettings();
      showToastNotification('Cover letter settings saved', 'success');
    });
  }
  
  // Cover letter reset button 
  const coverLetterResetBtn = document.getElementById('resetCoverLetterBtn');
  if (coverLetterResetBtn) {
    coverLetterResetBtn.addEventListener('click', function() {
      // Reset to defaults
      const styleSelect = document.getElementById('coverLetterStyle');
      if (styleSelect) styleSelect.value = 'Professional';
      
      // Reset checkboxes
      document.querySelector('#coverletter input[type="checkbox"][data-setting="achievements"]').checked = true;
      document.querySelector('#coverletter input[type="checkbox"][data-setting="companyResearch"]').checked = true;
      document.querySelector('#coverletter input[type="checkbox"][data-setting="salary"]').checked = false;
      
      // Clear custom closing
      document.querySelector('#coverletter textarea').value = '';
      
      // Save these default settings
      saveCoverLetterSettings();
      showToastNotification('Cover letter settings reset to defaults', 'info');
    });
  }
  
  // Advanced settings save button
  const advancedSaveBtn = document.querySelector('#advanced .settings-footer button:last-child');
  if (advancedSaveBtn) {
    advancedSaveBtn.addEventListener('click', saveAdvancedSettings);
  }
  
  // Advanced settings reset button
  const advancedResetBtn = document.querySelector('#advanced .settings-footer button:first-child');
  if (advancedResetBtn) {
    advancedResetBtn.addEventListener('click', function() {
      // Reset to defaults
      document.getElementById('autoSubmitCheckbox').checked = true;
      document.getElementById('enhancedMatchingCheckbox').checked = true;
      document.getElementById('autosaveCheckbox').checked = false;
      
      const aiPersonalitySelect = document.getElementById('aiPersonalitySelect');
      if (aiPersonalitySelect) aiPersonalitySelect.selectedIndex = 0; // First option
      
      // Save these default settings
      saveAdvancedSettings();
    });
  }

  // Support query submission
  const sendSupportBtn = document.getElementById('send-support-message');
  if (sendSupportBtn) {
    sendSupportBtn.addEventListener('click', function() {
      submitSupportQuery();
    });
  }
  
  // Refresh support queries
  const refreshQueriesBtn = document.getElementById('refresh-support-queries');
  if (refreshQueriesBtn) {
    refreshQueriesBtn.addEventListener('click', function() {
      loadSupportQueries(true);
      showToastNotification('Refreshing support queries...', 'info');
    });
  }
}

// Helper function to show error messages
function showErrorMessage(message) {
  const errorEl = document.getElementById('signupError');
  if (!errorEl) return;
  
  errorEl.textContent = message;
  errorEl.classList.add('visible');
  
  // Hide the message after 4 seconds
  setTimeout(() => {
    errorEl.classList.remove('visible');
  }, 4000);
}

// Function to show the signup form
function showSignupForm() {
  const signupHeader = document.querySelector('#signupPage .signup-header h2');
  const createAccountBtn = document.getElementById('createAccountBtn');
  const confirmPasswordField = document.getElementById('signupConfirmPassword');
  const newsletterOption = document.querySelector('.signup-options');
  const loginLink = document.querySelector('.login-link');
  
  if (!signupHeader || !createAccountBtn || !confirmPasswordField || !newsletterOption || !loginLink) return;
  
  signupHeader.textContent = 'Create Your Account';
  document.querySelector('#signupPage .signup-header p').textContent = 'Get started with SnapPhil to make job applications easier';
  createAccountBtn.textContent = 'Create Account';
  confirmPasswordField.parentElement.style.display = 'block';
  newsletterOption.style.display = 'block';
  loginLink.innerHTML = 'Already have an account? <span id="showLoginBtn" class="login-link-btn">Log in</span>';
  
  // Add event listener for the "Log in" link
  document.getElementById('showLoginBtn')?.addEventListener('click', () => {
    const signupHeader = document.querySelector('#signupPage .signup-header h2');
    const createAccountBtn = document.getElementById('createAccountBtn');
    const confirmPasswordField = document.getElementById('signupConfirmPassword');
    const newsletterOption = document.querySelector('.signup-options');
    const loginLink = document.querySelector('.login-link');
    
    if (!signupHeader || !createAccountBtn || !confirmPasswordField || !newsletterOption || !loginLink) return;
    
    signupHeader.textContent = 'Log In';
    document.querySelector('#signupPage .signup-header p').textContent = 'Welcome back to SnapPhil';
    createAccountBtn.textContent = 'Log In';
    confirmPasswordField.parentElement.style.display = 'none';
    newsletterOption.style.display = 'none';
    loginLink.innerHTML = 'Don\'t have an account? <span id="showSignupBtn" class="login-link-btn">Sign up</span>';
    
    // Add event listener for the "Sign up" link
    document.getElementById('showSignupBtn')?.addEventListener('click', showSignupForm);
    
    // Change button action
    createAccountBtn.removeEventListener('click', createAccount);
    createAccountBtn.addEventListener('click', loginUser);
  });
  
  // Change button action
  createAccountBtn.removeEventListener('click', loginUser);
  createAccountBtn.addEventListener('click', createAccount);
}

// Improved login function with proper communication
function loginUser() {
  console.log('Login function called');
  
  const email = document.getElementById('loginEmail')?.value;
  const password = document.getElementById('loginPassword')?.value;
  const loginError = document.getElementById('loginError');
  
  // Validate inputs
  if (!email || !password) {
    if (loginError) loginError.textContent = 'Please enter both email and password';
    return;
  }
  
  // Clear previous errors
  if (loginError) loginError.textContent = '';
  
  // Show loading state
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
  }
  
  console.log(`Attempting to log in with email: ${email}`);
  
  // Call login API
  fetch(backendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'login',
          email: email,
      password: password
    })
  })
  .then(response => response.json())
  .then(response => {
    if (response.success) {
      console.log('Login successful:', response);
      
      // Format session data properly
      const sessionData = {
        userId: response.userId,
        sessionToken: response.sessionToken,
        email: response.email,
        name: response.name,
        userTier: response.userTier || 'FREE',
        applicationsRemaining: response.applicationsRemaining || 0,
        tokenExpiry: response.tokenExpiry,
        tokenUsage: response.tokenUsage || 0,
        userContext: response.userContext || null,
        dynamicDailyLimit: response.dynamicDailyLimit
        };
        
        // Store session in Chrome storage
      saveToStorage('userSession', sessionData, () => {
        console.log("Session saved to storage");
      });
      
      // Store in localStorage for quick access
      localStorage.setItem('jobAppAutomator_session', JSON.stringify(sessionData));
      
      // Update global auth state
      isAuthenticated = true;
      userSession = sessionData;
      
      // Update UI
        updateUIForAuthState(true);
        
      // Hide welcome panel
        const welcomePanel = document.getElementById('welcomePanel');
        if (welcomePanel) {
            welcomePanel.style.display = 'none';
      }
      
      // Send message to parent window (content script)
      if (isInIframe()) {
        window.parent.postMessage({
          type: 'auth',
          action: 'login_success',
          session: sessionData
        }, '*');
      }
      
      // Send message to background script
      try {
        chrome.runtime.sendMessage({
          action: 'authStateChanged',
          isLoggedIn: true,
          session: sessionData
        });
      } catch (err) {
        console.log("Failed to send message to runtime:", err);
      }
      
      // Show success message
      showToastNotification('Successfully logged in!', 'success');
      
      // Load user data
      loadContextData();
      loadApplicationHistory();
    } else {
      console.log('Login failed:', response);
      // Show error
      if (loginError) loginError.textContent = response.error || 'Login failed. Please check your credentials.';
    }
  })
  .catch(error => {
    console.error('Login error:', error);
    if (loginError) loginError.textContent = 'Network error. Please try again.';
  })
  .finally(() => {
    // Reset button state
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
  });
}

// Improved account creation function
function createAccount() {
  console.log('Create account function called');
  
  const name = document.getElementById('signupName')?.value;
  const email = document.getElementById('signupEmail')?.value;
  const password = document.getElementById('signupPassword')?.value;
  const confirmPassword = document.getElementById('signupConfirmPassword')?.value;
  const signupError = document.getElementById('signupError');
  
  // Validate inputs
  if (!name || !email || !password || !confirmPassword) {
    if (signupError) signupError.textContent = 'Please fill in all fields';
    return;
  }
  
  if (password !== confirmPassword) {
    if (signupError) signupError.textContent = 'Passwords do not match';
    return;
  }
  
  // Clear previous errors
  if (signupError) signupError.textContent = '';
  
  // Show loading state
  const createAccountBtn = document.getElementById('createAccountBtn');
  if (createAccountBtn) {
    createAccountBtn.disabled = true;
    createAccountBtn.textContent = 'Creating Account...';
  }
  
  console.log(`Attempting to create account for: ${email}`);
  
  // Call API to create account
  fetch(backendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'register',
      name: name,
      email: email,
      password: password
    })
  })
  .then(response => response.json())
  .then(response => {
    if (response.success) {
      console.log('Account creation successful:', response);
      
      // Format session data
      const sessionData = {
        userId: response.userId,
        sessionToken: response.sessionToken,
        email: response.email,
        name: response.name,
        userTier: response.userTier || 'FREE',
        applicationsRemaining: response.applicationsRemaining || 0,
        tokenExpiry: response.tokenExpiry,
        tokenUsage: response.tokenUsage || 0,
        userContext: response.userContext || null,
        dynamicDailyLimit: response.dynamicDailyLimit
      };
      
      // Store session in Chrome storage
      saveToStorage('userSession', sessionData, () => {
        console.log("Session saved to storage");
      });
      
      // Store in localStorage for quick access
      localStorage.setItem('jobAppAutomator_session', JSON.stringify(sessionData));
      
      // Update global state
      isAuthenticated = true;
      userSession = sessionData;
        
        // Update UI
        updateUIForAuthState(true);
        
      // Hide welcome panel
        const welcomePanel = document.getElementById('welcomePanel');
        if (welcomePanel) {
            welcomePanel.style.display = 'none';
      }
      
      // Send message to parent window (content script)
      if (isInIframe()) {
        window.parent.postMessage({
          type: 'auth',
          action: 'signup_success',
          session: sessionData
        }, '*');
      }
      
      // Send message to background script
      try {
        chrome.runtime.sendMessage({
          action: 'authStateChanged',
          isLoggedIn: true,
          session: sessionData
        });
      } catch (err) {
        console.log("Failed to send message to runtime:", err);
      }
      
      // Show success message
      showToastNotification('Account created successfully!', 'success');
      
      // Load user data
      loadContextData();
      loadApplicationHistory();
    } else {
      console.log('Account creation failed:', response);
      // Show error message
      if (signupError) signupError.textContent = response.error || 'Failed to create account. Please try again.';
    }
  })
  .catch(error => {
    console.error('Account creation error:', error);
    if (signupError) signupError.textContent = 'Network error. Please try again.';
  })
  .finally(() => {
    // Reset button state
    if (createAccountBtn) {
      createAccountBtn.disabled = false;
      createAccountBtn.textContent = 'Create Account';
    }
  });
}

// Improve logout function with proper communication
function logout() {
  // Clear session data
  chrome.storage.local.remove('userSession', () => {
    console.log("Session removed from Chrome storage");
  });
  
  localStorage.removeItem('jobAppAutomator_session');
  
  // Update global auth state
  isAuthenticated = false;
  userSession = null;
  
  // Update UI
  updateUIForAuthState(false);
  
  // Send message to parent window (content script)
  window.parent.postMessage({
    type: 'auth',
    action: 'logout'
  }, '*');
  
  // Send message to background script
  try {
    chrome.runtime.sendMessage({
      action: 'authStateChanged',
      isLoggedIn: false
    });
  } catch (err) {
    console.log("Failed to send message to runtime:", err);
  }
  
  // Show success message
  showToastNotification('Successfully logged out', 'info');
}

// Function to update UI based on authentication state
function updateUIForAuthState(isLoggedIn) {
  // Update UI elements based on authentication status
  console.log(`Updating UI for auth state: ${isLoggedIn}`);
  
  // Update login/logout buttons
  const loginButtons = document.querySelectorAll('.login-btn');
  const logoutButtons = document.querySelectorAll('.logout-btn');
  
  loginButtons.forEach(btn => {
    btn.style.display = isLoggedIn ? 'none' : 'inline-block';
  });
  
  logoutButtons.forEach(btn => {
    btn.style.display = isLoggedIn ? 'inline-block' : 'none';
    // Ensure logout triggers a full cache clear
    if (!btn._snapphilLogoutBound) {
      btn.addEventListener('click', () => {
        try { chrome.runtime.sendMessage({ action: 'auth:logout' }); } catch (_) {}
        chrome.storage.local.remove('userSession', () => window.location.reload());
      });
      btn._snapphilLogoutBound = true;
    }
  });
  
  // Update user profile info
  const userProfileElements = document.querySelectorAll('.user-profile');
  userProfileElements.forEach(el => {
    el.style.display = isLoggedIn ? 'flex' : 'none';
  });
  
  // Update user info if logged in
  if (isLoggedIn && userSession) {
    // Update user name - show actual name from server if available, otherwise "User"
    const userNameElement = document.getElementById('userName');
    if (userNameElement) {
      userNameElement.textContent = userSession.name || 'User';
    }
    
    // Update user email
    const userEmailElement = document.getElementById('userEmail');
    if (userEmailElement) {
      userEmailElement.textContent = userSession.email || '';
    }
    
    // Set user initial based on name from server
    const userInitialElement = document.getElementById('userInitial');
    if (userInitialElement) {
      const nameForInitial = userSession.name || userSession.email || 'User';
      userInitialElement.textContent = nameForInitial.charAt(0).toUpperCase();
    }
    
    // Also update any legacy elements that might exist
    const accountNameElements = document.querySelectorAll('.user-name-large');
    accountNameElements.forEach(el => {
      el.textContent = userSession.name || userSession.email || 'User';
    });
    
    const userInitialElements = document.querySelectorAll('.user-initial');
    userInitialElements.forEach(el => {
      const nameForInitial = userSession.name || userSession.email || 'User';
      el.textContent = nameForInitial.charAt(0).toUpperCase();
    });
  }
  
  // Show/hide auth-dependent sections
  const authRequiredElements = document.querySelectorAll('.auth-required');
  authRequiredElements.forEach(el => {
    el.style.display = isLoggedIn ? 'block' : 'none';
  });
  
  const noAuthElements = document.querySelectorAll('.no-auth-only');
  noAuthElements.forEach(el => {
    el.style.display = isLoggedIn ? 'none' : 'block';
  });
  
  // Enable/disable start button
  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.disabled = !isLoggedIn;
    startBtn.title = isLoggedIn ? "Auto-fill the current form" : "Please sign in to use auto-fill";
  }
  // Hide onboarding panel (welcome, terms, auth) for authenticated users
  const welcomePanel = document.getElementById('welcomePanel');
  if (welcomePanel) {
    welcomePanel.style.display = isLoggedIn ? 'none' : 'block';
  }

  // Load support queries when authenticated
  if (isLoggedIn) {
    loadSupportQueries();
  } else {
    supportQueriesRequest = null;
    dataLoading.supportQueries = false;
    const supportQueriesContainer = document.getElementById('support-queries-container');
    if (supportQueriesContainer) {
      supportQueriesContainer.innerHTML = `
        <div class="support-query-empty">
          <p>Sign in to view your support conversations.</p>
        </div>
      `;
    }
  }
}

// Main initialization function
function init() {
  console.log("Initializing SnapPhil interface...");
  showLoading('general');
  console.log("[DEBUG] init() function starting...");
  
  // Check for user session
  chrome.storage.local.get('userSession', function(result) {
    if (result && result.userSession) {
      userSession = result.userSession;
      isAuthenticated = true;
      updateUIForAuthState(true);
      
      // Also validate with server if needed
      validateSession(userSession);
      
      setTimeout(() => {
        loadApplicationHistory();
        loadContextData();
      }, 100);
    } else {
      // Check with background script as well
      sendMessageToBackground({ action: "getUserSession" }, function(response) {
        if (response && response.session) {
          userSession = response.session;
          isAuthenticated = true;
          updateUIForAuthState(true);
          
          // Also validate with server if needed
          validateSession(userSession);
          
          setTimeout(() => {
            loadApplicationHistory();
            loadContextData();
          }, 100);
        } else {
          isAuthenticated = false;
          updateUIForAuthState(false);
          markDataLoaded('applications');
          markDataLoaded('resume');
          markDataLoaded('context');
          markDataLoaded('settings');
        }
      });
    }
  });
  
  setupEventListeners();
  initFileUpload();
  loadCoverLetterSettings();
  loadAdvancedSettings();

  // Schedule adaptive failsafe rather than a fixed 5s cutoff
  scheduleLoadingFailsafe();
}

// Validate session with server
function validateSession(session) {
  if (!session?.userId || !session?.sessionToken) return Promise.resolve();
  
  return fetch(`${backendApiUrl}?action=getUserInfo&userId=${session.userId}&sessionToken=${session.sessionToken}`)
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Session is valid, update with latest info
        userSession = { ...userSession, ...data };
        
        // Update session in Chrome storage
        chrome.storage.local.set({ 'userSession': userSession }, function() {
          console.log('Updated user session saved to Chrome storage.');
        });
        
        // Update localStorage as well
        localStorage.setItem('jobAppAutomator_session', JSON.stringify(userSession));
        
        // Update UI with new user info
        updateUIForAuthState(true);
        
        // Update session in background
        sendMessageToBackground({
          action: "setUserSession",
          session: userSession
        });
      } else {
        // Session invalid, log out
        isAuthenticated = false;
        userSession = null;
        
        // Clear session from storage
        chrome.storage.local.remove('userSession', function() {
          console.log('Invalid session removed from Chrome storage.');
        });
        
        localStorage.removeItem('jobAppAutomator_session');
        
        // Update UI
        updateUIForAuthState(false);
        
        // Show login prompt if needed
        if (data.error && (data.error.includes("Invalid session") || data.error.includes("Session expired"))) {
          showStatus("Session expired. Please sign in again.", "warning");
        }
      }
    })
    .catch(error => {
      console.error("Error validating session:", error);
      // Don't log out on connection errors to allow offline use
    });
}

// Initialize authentication when the document is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('Settings panel loaded, initializing authentication...');
  
  // Check authentication status
  chrome.storage.local.get(['userSession'], function(result) {
    if (result.userSession) {
      // Session exists, validate it
      isAuthenticated = true;
      userSession = result.userSession;
      
      // Update UI for authenticated state
      updateUIForAuthState(true);
      
      // Validate session with server
      validateSession(userSession)
        .then(response => {
          if (response.success) {
            console.log('Session validated successfully');
            // Update session with any new data
            userSession = {...userSession, ...response};
            
            // Save the updated session
            chrome.storage.local.set({userSession: userSession});
            localStorage.setItem('jobAppAutomator_session', JSON.stringify(userSession));
            
            // Load user data
            loadContextData();
            loadApplicationHistory();
          } else {
            console.log('Session validation failed, logging out');
            isAuthenticated = false;
            userSession = null;
            updateUIForAuthState(false);
            
            // Clear invalid session
            chrome.storage.local.remove(['userSession']);
            localStorage.removeItem('jobAppAutomator_session');
          }
        })
        .catch(error => {
          console.error('Error validating session:', error);
          isAuthenticated = false;
          userSession = null;
          updateUIForAuthState(false);
        });
    } else {
      // No session, show login UI
      isAuthenticated = false;
      userSession = null;
      updateUIForAuthState(false);
    }
  });
  
  // Initialize event listeners
  console.log('[DEBUG] DOM fully loaded, initializing SnapPhil...');
  init();
  
  initializeContextTags();
});

// Helper function to check if running in iframe
function isInIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

// Call init function or setup listeners for iframe communication
if (isInIframe()) {
  console.log('Running in iframe, setting up cross-window messaging');
  
  // Listen for messages from the parent window (content script)
  window.addEventListener('message', function(event) {
    // Validate message origin
    const extensionOrigin = chrome.runtime.getURL('').slice(0, -1);
    if (event.origin !== extensionOrigin) {
      return;
    }
    
    if (event.data.type === 'auth_init') {
      // Initialize auth with provided session
      if (event.data.session) {
        isAuthenticated = true;
        userSession = event.data.session;
        updateUIForAuthState(true);
        
        // Load user data
        loadContextData();
        loadApplicationHistory();
      } else {
        isAuthenticated = false;
        userSession = null;
        updateUIForAuthState(false);
      }
    }
  });
  
  // Notify the parent window that the iframe is ready
  window.parent.postMessage({
    type: 'iframe_ready',
    action: 'auth_ready'
  }, '*');
} else {
  // Running as standalone page, init normally
  init();
}

// Add this function to load cover letter settings
async function loadCoverLetterSettings() {
  dataLoading.coverLetterSettings = true;
  showLoading('coverLetterSettings');
  
  const localSettings = await getLocalCoverLetterSettings();
  if (localSettings) {
    applyCoverLetterSettings(localSettings);
  } else {
    console.log("No cover letter settings found, initializing defaults");
    saveCoverLetterSettings();
  }
  
  markDataLoaded('coverLetterSettings');
  
  if (!isAuthenticated || !userSession) {
    return;
  }
  
  const cachedState = await getCachedSectionState('coverLetterSettings');
  if (cachedState.isFresh) {
    return;
  }
  
  try {
    const response = await fetch(`${backendApiUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getUserCoverLetterSettings',
        userId: userSession.userId,
        sessionToken: userSession.sessionToken
      })
    });
    const data = await response.json();
    if (data.success && data.settings) {
      console.log("Cover letter settings refreshed from server:", data.settings);
      chrome.storage.local.set({ coverLetterSettings: data.settings });
      cacheSection('coverLetterSettings', data.settings);
      applyCoverLetterSettings(data.settings);
    }
  } catch (error) {
    console.error("Error loading cover letter settings from server:", error);
  }
}

function getLocalCoverLetterSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['coverLetterSettings'], function(result) {
      resolve(result.coverLetterSettings || null);
    });
  });
}

// Helper function to apply cover letter settings to UI
function applyCoverLetterSettings(settings) {
  // Populate UI with loaded settings
  const styleSelect = document.querySelector('#coverletter select.form-control');
  if (styleSelect && settings.style) {
    for (let i = 0; i < styleSelect.options.length; i++) {
      if (styleSelect.options[i].value === settings.style) {
        styleSelect.selectedIndex = i;
        break;
      }
    }
  }
  
  // Set checkboxes
  const achievementsCheckbox = document.querySelector('#coverletter input[type="checkbox"][data-setting="achievements"]');
  if (achievementsCheckbox && settings.includeAchievements !== undefined) {
    achievementsCheckbox.checked = settings.includeAchievements;
  }
  
  const companyResearchCheckbox = document.querySelector('#coverletter input[type="checkbox"][data-setting="companyResearch"]');
  if (companyResearchCheckbox && settings.mentionCompanyResearch !== undefined) {
    companyResearchCheckbox.checked = settings.mentionCompanyResearch;
  }
  
  const salaryCheckbox = document.querySelector('#coverletter input[type="checkbox"][data-setting="salary"]');
  if (salaryCheckbox && settings.includeSalary !== undefined) {
    salaryCheckbox.checked = settings.includeSalary;
  }
  
  // Set custom closing
  const closingTextarea = document.querySelector('#coverletter textarea');
  if (closingTextarea && settings.customClosing) {
    closingTextarea.value = settings.customClosing;
  }
}

// Update this function to save cover letter settings
function saveCoverLetterSettings() {
  const settings = {
    style: document.querySelector('#coverletter select.form-control').value,
    includeAchievements: document.querySelector('#coverletter input[type="checkbox"][data-setting="achievements"]').checked,
    mentionCompanyResearch: document.querySelector('#coverletter input[type="checkbox"][data-setting="companyResearch"]').checked,
    includeSalary: document.querySelector('#coverletter input[type="checkbox"][data-setting="salary"]').checked,
    customClosing: document.querySelector('#coverletter textarea').value
  };
  
  console.log("Saving cover letter settings:", settings);
  
  // Save to storage
  chrome.storage.local.set({ coverLetterSettings: settings }, function() {
    console.log("Cover letter settings saved locally");
    cacheSection('coverLetterSettings', settings);
  });
  
  // If authenticated, save to server
  if (isAuthenticated && userSession) {
    showLoading('coverLetterSettings');
    
    fetch(backendApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveUserCoverLetterSettings',
        userId: userSession.userId,
        sessionToken: userSession.sessionToken,
        settings: settings
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showStatus("Cover letter settings saved successfully", "success");
      } else {
        console.error("Error saving cover letter settings to server:", data.error);
        showStatus("Settings saved locally, but server sync failed", "warning");
      }
      hideLoading();
    })
    .catch(error => {
      console.error("Error saving to server:", error);
      showStatus("Settings saved locally, but server sync failed", "warning");
      hideLoading();
    });
  } else {
    showStatus("Cover letter settings saved locally", "success");
  }
  
  // Send to background script to update context
  chrome.runtime.sendMessage({
    action: 'updateCoverLetterSettings',
    settings: settings
  });
}

// Add this function to load advanced settings
function loadAdvancedSettings() {
  dataLoading.advancedSettings = true;
  showLoading('advancedSettings');
  
  chrome.storage.local.get(['advancedSettings', 'autoOpenPopup'], function(result) {
    let settings = result.advancedSettings;
    
    if (settings) {
      console.log("Advanced settings loaded:", settings);
      
      // Populate UI with loaded settings
      document.getElementById('autoSubmitCheckbox').checked = settings.fillOptionalFields !== undefined ? 
        settings.fillOptionalFields : true;
        
      document.getElementById('enhancedMatchingCheckbox').checked = settings.enhancedJobMatching !== undefined ? 
        settings.enhancedJobMatching : true;
        
      document.getElementById('autosaveCheckbox').checked = settings.autosaveApplications !== undefined ? 
        settings.autosaveApplications : false;
      
      const aiPersonalitySelect = document.getElementById('aiPersonalitySelect');
      if (aiPersonalitySelect && settings.aiPersonality) {
        for (let i = 0; i < aiPersonalitySelect.options.length; i++) {
          if (aiPersonalitySelect.options[i].text === settings.aiPersonality) {
            aiPersonalitySelect.selectedIndex = i;
            break;
          }
        }
      }
    } else {
      // If no settings found, initialize with defaults
      saveAdvancedSettings();
    }
    
    // Load auto-open popup setting (separate storage key)
    const autoOpenCheckbox = document.getElementById('autoOpenPopupCheckbox');
    if (autoOpenCheckbox) {
      // If setting exists use it, otherwise default to true
      autoOpenCheckbox.checked = result.autoOpenPopup !== false;
    }
    
    markDataLoaded('advancedSettings');
  });
}

// Add this function to save advanced settings
function saveAdvancedSettings() {
  const settings = {
    fillOptionalFields: document.getElementById('autoSubmitCheckbox').checked,
    enhancedJobMatching: document.getElementById('enhancedMatchingCheckbox').checked,
    autosaveApplications: document.getElementById('autosaveCheckbox').checked,
    aiPersonality: document.getElementById('aiPersonalitySelect').value
  };
  
  console.log("Saving advanced settings:", settings);
  
  // Save to storage
  chrome.storage.local.set({ advancedSettings: settings }, function() {
    console.log("Advanced settings saved");
    showStatus("Advanced settings saved successfully", "success");
  });
  
  // Save auto-open popup setting separately
  const autoOpenPopup = document.getElementById('autoOpenPopupCheckbox').checked;
  chrome.storage.local.set({ autoOpenPopup: autoOpenPopup });
  
  // Send to background script to update auto-open setting
  chrome.runtime.sendMessage({
    action: 'toggleAutoOpenPopup',
    enabled: autoOpenPopup
  });
  
  // Send to background script to update context
  chrome.runtime.sendMessage({
    action: 'updateAdvancedSettings',
    settings: settings
  });
}

// Load support queries for the current user
let supportQueriesRequest = null;

async function loadSupportQueries(forceRefresh = false) {
  if (!userSession || !userSession.userId || !userSession.sessionToken) {
    console.log("User not authenticated, can't load support queries");
    return;
  }
  
  if (supportQueriesRequest && !forceRefresh) {
    return supportQueriesRequest;
  }
  
  dataLoading.supportQueries = true;
  renderSupportQueriesSkeleton();
  
  const cachedState = await getCachedSectionState('supportQueries');
  if (cachedState.payload && cachedState.payload.length) {
    renderSupportQueriesList(cachedState.payload);
  }
  
  markDataLoaded('supportQueries');
  
  if (!forceRefresh && cachedState.isFresh) {
    return;
  }
  
  supportQueriesRequest = fetch(backendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'getUserSupportQueries',
      userId: userSession.userId,
      sessionToken: userSession.sessionToken
    })
  })
  .then(response => response.json())
  .then(data => {
    if (!data.success) {
      console.error("Error loading support queries:", data.error);
      if (!cachedState.payload) {
        renderSupportQueriesError("Error loading support queries. Please try again later.");
      }
      return;
    }
    cacheSection('supportQueries', data.queries || []);
    renderSupportQueriesList(data.queries || []);
  })
  .catch(error => {
    console.error("Error fetching support queries:", error);
    if (!cachedState.payload) {
      renderSupportQueriesError("Error loading support queries. Please try again later.");
    }
  })
  .finally(() => {
    dataLoading.supportQueries = false;
    supportQueriesRequest = null;
  });
  
  return supportQueriesRequest;
}

function renderSupportQueriesList(queries) {
  const supportQueriesContainer = document.getElementById('support-queries-container');
  if (!supportQueriesContainer) return;
  
  if (!queries || queries.length === 0) {
    supportQueriesContainer.innerHTML = `
      <div class="support-query-empty">
        <p>You haven't submitted any support queries yet.</p>
      </div>
    `;
    return;
  }
  
  const sortedQueries = [...queries].sort((a, b) => {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  
  const queriesHTML = sortedQueries.map(query => {
    const date = new Date(query.timestamp);
    const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const isAnswered = query.developerMessage && query.developerMessage.trim() !== '';
    const statusClass = isAnswered ? 'answered' : 'pending';
    const statusText = isAnswered ? 'Answered' : 'Pending';
    
    return `
      <div class="support-query">
        <div class="support-query-header">
          <div>
            <span class="support-query-subject">${escapeHtml(query.subject)}</span>
            <span class="support-query-status ${statusClass}">${statusText}</span>
          </div>
            <span class="support-query-date">${formattedDate}</span>
        </div>
        <div class="support-query-message">${escapeHtml(query.message)}</div>
        ${isAnswered ? `<div class="support-query-response">${escapeHtml(query.developerMessage)}</div>` : ''}
      </div>
    `;
  }).join('');
  
  supportQueriesContainer.innerHTML = queriesHTML;
}

function renderSupportQueriesError(message) {
  const supportQueriesContainer = document.getElementById('support-queries-container');
  if (!supportQueriesContainer) return;
  supportQueriesContainer.innerHTML = `
    <div class="support-query-empty">
      <p>${message}</p>
    </div>
  `;
}

// Submit a new support query
function submitSupportQuery() {
  // Get form values
  const subjectInput = document.getElementById('support-subject');
  const messageInput = document.getElementById('support-message');
  
  const subject = subjectInput.value.trim();
  const message = messageInput.value.trim();
  
  // Validate inputs
  if (!subject) {
    showToastNotification('Please enter a subject for your support request', 'error');
    subjectInput.focus();
    return;
  }
  
  if (!message) {
    showToastNotification('Please enter a message for your support request', 'error');
    messageInput.focus();
    return;
  }
  
  // Ensure user is logged in
  if (!userSession || !userSession.userId || !userSession.sessionToken) {
    showToastNotification('You must be logged in to submit a support request', 'error');
    return;
  }
  
  // Disable the form
  const sendButton = document.getElementById('send-support-message');
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';
  }
  
  // Collect browser information for troubleshooting
  const browserInfo = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookiesEnabled: navigator.cookieEnabled,
    screenResolution: `${window.screen.width}x${window.screen.height}`
  };
  
  // Make the API request
  fetch(backendApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'submitSupportQuery',
      userId: userSession.userId,
      sessionToken: userSession.sessionToken,
      subject: subject,
      message: message,
      userData: {
        email: userSession.email,
        name: userSession.name,
        userTier: userSession.userTier
      },
      source: 'Settings Panel',
      browserInfo: JSON.stringify(browserInfo)
    })
  })
  .then(response => response.json())
  .then(data => {
    // Re-enable the form
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
        <span>Send Message</span>
      `;
    }
    
    if (data.success) {
      // Clear the form
      subjectInput.value = '';
      messageInput.value = '';
      
      // Show success message
      showToastNotification('Your support request has been submitted successfully', 'success');
      
      // Reload the support queries to include the new one
      loadSupportQueries(true);
    } else {
      // Show error message
      showToastNotification(`Error submitting support request: ${data.error}`, 'error');
    }
  })
  .catch(error => {
    // Re-enable the form
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
        <span>Send Message</span>
      `;
    }
    
    console.error("Error submitting support request:", error);
    showToastNotification('Error submitting support request. Please try again later.', 'error');
  });
}

// Helper function to escape HTML (for security)
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Feed More Info Questionnaire Logic ---
const questionnaireAnswers = {};

function showQuestionScreen(id) {
  document.querySelectorAll('.question-screen').forEach(q => q.classList.add('hidden'));
  const q = document.getElementById(id);
  if (q) q.classList.remove('hidden');
}

function setupQuestionnaire() {
  // Q1: MCQ (radio)
  const q1Radios = document.querySelectorAll('#question-1 .option-input');
  q1Radios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        questionnaireAnswers['job-status'] = this.id;
        showQuestionScreen('question-2');
        // Focus text input for Q2
        setTimeout(() => {
          document.querySelector('#question-2 .question-text-input')?.focus();
        }, 100);
      }
    });
  });

  // Q2: Text input + OK button
  const q2Input = document.querySelector('#question-2 .question-text-input');
  const q2Next = document.getElementById('q2-next');
  if (q2Input && q2Next) {
    q2Next.addEventListener('click', function() {
      const val = q2Input.value.trim();
      if (val) {
        questionnaireAnswers['industry'] = val;
        showQuestionScreen('question-3');
      } else {
        q2Input.focus();
      }
    });
    q2Input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        q2Next.click();
      }
    });
  }

  // Q3: MCQ (radio)
  const q3Radios = document.querySelectorAll('#question-3 .option-input');
  q3Radios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        questionnaireAnswers['work-arrangement'] = this.id;
        showQuestionScreen('question-4');
      }
    });
  });

  // Q4: MCQ (radio)
  const q4Radios = document.querySelectorAll('#question-4 .option-input');
  q4Radios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        questionnaireAnswers['app-volume'] = this.id;
        showQuestionScreen('complete-screen');
      }
    });
  });

  // Completion: Done button
  const doneBtn = document.getElementById('complete-button');
  if (doneBtn) {
    doneBtn.addEventListener('click', function() {
      // Optionally: send answers to backend here
      // Reset questionnaire for next time
      Object.keys(questionnaireAnswers).forEach(k => delete questionnaireAnswers[k]);
      // Reset radios and text
      document.querySelectorAll('.question-screen .option-input').forEach(r => r.checked = false);
      if (q2Input) q2Input.value = '';
      showQuestionScreen('question-1');
    });
  }

  // Start with Q1 visible
  showQuestionScreen('question-1');
}

// Call setupQuestionnaire from init()
const _originalInit = init;
init = function() {
  _originalInit();
  setupQuestionnaire();
};

function setupFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    if (!question || !answer) return;

    // Collapse all answers initially
    answer.style.maxHeight = '0px';
    answer.style.overflow = 'hidden';
    answer.style.transition = 'max-height 0.35s cubic-bezier(0.4, 0.2, 0.2, 1)';

    question.addEventListener('click', function() {
      // Collapse all other items
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
          const otherAnswer = otherItem.querySelector('.faq-answer');
          if (otherAnswer) {
            otherAnswer.style.maxHeight = '0px';
          }
        }
      });

      // Toggle this item
      const isActive = item.classList.contains('active');
      if (isActive) {
        item.classList.remove('active');
        answer.style.maxHeight = '0px';
      } else {
        item.classList.add('active');
        // Calculate height based on content
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });
}

// Patch init to call setupFaqAccordion
const _originalInit2 = init;
init = function() {
  _originalInit2();
  setupFaqAccordion();
};

// Function to initialize context tag functionality
function initializeContextTags() {
  const contextInput = document.querySelector('.context-input');
  const charCount = document.getElementById('char-count');
  const contextTags = document.querySelectorAll('.context-tag');
  const saveButton = document.getElementById('context-save-btn');
  const cancelButton = document.getElementById('context-cancel-btn');
  
  // Initialize character count
  if (contextInput && charCount) {
    // Set initial character count
    charCount.textContent = contextInput.value.length;
    
    // Update character count on input
    contextInput.addEventListener('input', function() {
      charCount.textContent = this.value.length;
      
      // Apply warning styling if approaching limit
      if (this.value.length > 400) {
        charCount.style.color = 'rgba(255, 180, 100, 0.9)';
      } else if (this.value.length > 480) {
        charCount.style.color = 'rgba(255, 100, 100, 0.9)';
      } else {
        charCount.style.color = 'rgba(255, 255, 255, 0.7)';
      }
    });
  }
  
  // Add click handlers for tags
  if (contextTags && contextInput) {
    contextTags.forEach(tag => {
      tag.addEventListener('click', function() {
        const tagText = this.getAttribute('data-tag');
        if (!tagText) return;
        
        // If text is selected, replace it with the tag
        const start = contextInput.selectionStart;
        const end = contextInput.selectionEnd;
        const currentText = contextInput.value;
        
        // Insert tag text with formatting
        const insertText = tagText + ": ";
        const newText = currentText.substring(0, start) + insertText + currentText.substring(end);
        
        // Set new text and update cursor position
        contextInput.value = newText;
        contextInput.focus();
        contextInput.setSelectionRange(start + insertText.length, start + insertText.length);
        
        // Trigger input event to update character count
        const inputEvent = new Event('input', { bubbles: true });
        contextInput.dispatchEvent(inputEvent);
      });
    });
  }
  
  // Add save button functionality
  if (saveButton) {
    saveButton.addEventListener('click', function() {
      saveContext();
    });
  }
  
  // Add cancel button functionality
  if (cancelButton && contextInput) {
    cancelButton.addEventListener('click', function() {
      // Restore from last saved version
      loadContextData();
    });
  }
}

// Add event listeners for status dropdown changes
document.querySelectorAll('.status-dropdown').forEach(dropdown => {
  console.log("Adding event listener to status dropdown:", dropdown);
  dropdown.addEventListener('change', function(e) {
    console.log("Status dropdown changed!", this);
    e.preventDefault();
    e.stopPropagation();
    
    const applicationId = this.getAttribute('data-id');
    const newStatus = this.value;
    
    console.log("Application ID:", applicationId, "New Status:", newStatus);
    
    if (applicationId && newStatus) {
      // Disable dropdown during update
      this.disabled = true;
      
      // Call update function
      updateApplicationStatus(applicationId, newStatus)
        .then(() => {
          console.log("Status updated successfully");
          // Re-enable dropdown
          this.disabled = false;
        })
        .catch((error) => {
          console.error("Error updating status:", error);
          // Re-enable dropdown and revert to previous value
          this.disabled = false;
          // Revert to previous selection - we'll need to find the original status
          loadApplicationHistory(); // This will refresh and restore correct values
          showStatus("Error updating status: " + error.toString(), "error");
        });
    } else {
      console.error("No application ID or status found");
    }
  });
});