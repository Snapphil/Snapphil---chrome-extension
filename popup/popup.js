document.addEventListener('DOMContentLoaded', function() {
  const autofillBtn = document.getElementById('autofillBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  // Check if we have a resume stored
  checkResumeAvailability();

  // Autofill button click handler
  autofillBtn.addEventListener('click', function(e) {
    console.log('Auto-fill button clicked at:', new Date().toISOString());
    console.time('autofill-process');
    
    // Don't proceed if button is disabled
    if (autofillBtn.classList.contains('disabled')) {
      console.log('Button is disabled, not proceeding with auto-fill');
      e.preventDefault();
      e.stopPropagation();
      
      // Show tooltip explaining why it's disabled
      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.textContent = 'Please upload a resume in settings first';
      tooltip.style.cssText = `
        position: absolute;
        bottom: -40px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        z-index: 1000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      `;
      
      autofillBtn.appendChild(tooltip);
      
      // Show tooltip
                    setTimeout(() => {
        tooltip.style.opacity = '1';
      }, 10);
      
      // Hide tooltip after 2 seconds
                setTimeout(() => {
        tooltip.style.opacity = '0';
        setTimeout(() => {
          autofillBtn.removeChild(tooltip);
        }, 200);
      }, 2000);
      
      return;
    }
    
    console.log('Getting current active tab...');
    // Get the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      console.log('Got active tab at:', new Date().toISOString());
      const activeTab = tabs[0];
      if (!activeTab) {
        console.error('No active tab found');
      return;
    }
    
      console.log('Sending startAutofill message to content script...');
      // Send message to content script to start autofill
      chrome.tabs.sendMessage(activeTab.id, { action: 'startAutofill' }, (response) => {
        console.log('Received response from content script:', response);
        console.timeEnd('autofill-process');
        
        if (chrome.runtime.lastError) {
          console.warn('Content script not loaded, injecting it first:', chrome.runtime.lastError);
          // If content script is not loaded, inject it first
          chrome.scripting.executeScript({ 
            target: { tabId: activeTab.id }, 
            files: ['content.js'] 
          }, () => {
            console.log('Content script injected, trying command again...');
            // After injection, try the command again
            chrome.tabs.sendMessage(activeTab.id, { action: 'startAutofill' });
          });
        }
        // Close the popup
        window.close();
      });
    });
  });

  // Settings button click handler
  settingsBtn.addEventListener('click', function() {
    console.log('Settings button clicked');
    // Get the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs[0];
      if (!activeTab) return;

      // Force a check for updated resume when opening settings
      chrome.runtime.sendMessage({ action: 'forceResumeRefresh' });

      // Send message to toggle settings panel
      chrome.tabs.sendMessage(activeTab.id, { action: 'toggleSettingsPanel' }, (response) => {
      if (chrome.runtime.lastError) {
          // If content script is not loaded, inject it first
          chrome.scripting.executeScript({ 
            target: { tabId: activeTab.id }, 
            files: ['content.js'] 
          }, () => {
            // After injection, try the command again
            chrome.tabs.sendMessage(activeTab.id, { action: 'toggleSettingsPanel' });
          });
        }
        // Close the popup
        window.close();
      });
    });
  });
  
  // Function to check if resume is available and update UI accordingly
  function checkResumeAvailability() {
    console.log('Checking resume availability...');
    
    // First, try to check directly in localStorage as a fallback
    const localStorageResume = localStorage.getItem('resumeData');
    if (localStorageResume) {
      try {
        const resumeData = JSON.parse(localStorageResume);
        if (resumeData) {
          console.log('Resume found in localStorage');
          // Resume found, make sure button is enabled
          autofillBtn.classList.remove('disabled');
          autofillBtn.removeAttribute('title');
          
          // Remove warning badge if it exists
          const existingBadge = autofillBtn.querySelector('.warning-badge');
          if (existingBadge) {
            autofillBtn.removeChild(existingBadge);
          }
          return; // Exit early as we found a resume
        }
      } catch (e) {
        console.error('Error parsing localStorage resume:', e);
      }
    }
    
    // If not found in localStorage, check with background script
    chrome.runtime.sendMessage({ action: 'checkResumeAvailability' }, function(response) {
      console.log('Resume availability response:', response);
      if (!response || !response.available) {
        // No resume found, disable autofill button and show a tooltip
        autofillBtn.classList.add('disabled');
        autofillBtn.setAttribute('title', 'Please upload a resume in settings first');
        
        // Add visual indication
        const warningSpan = document.createElement('span');
        warningSpan.className = 'warning-badge';
        warningSpan.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        autofillBtn.appendChild(warningSpan);
        
        // Add CSS for disabled button
        const style = document.createElement('style');
        style.textContent = `
          .autofill-btn.disabled {
            opacity: 0.7;
            background: linear-gradient(90deg, #a88b3b, #a27e2a);
            cursor: not-allowed;
          }
          .warning-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: #ff453a;
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            font-size: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(0,0,0,0.1);
          }
        `;
        document.head.appendChild(style);
        } else {
        // Resume found, make sure button is enabled
        console.log('Resume found, enabling autofill button');
        autofillBtn.classList.remove('disabled');
        autofillBtn.removeAttribute('title');
        
        // Remove warning badge if it exists
        const existingBadge = autofillBtn.querySelector('.warning-badge');
        if (existingBadge) {
          autofillBtn.removeChild(existingBadge);
        }
      }
    });
  }
});