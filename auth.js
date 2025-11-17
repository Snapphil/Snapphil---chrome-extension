// auth.js - Authentication module for Job Application Automator

// Configuration
const AUTH_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbx51SIMS8LHseKPY907psklUCcZ6QqIayglzVLJnlQPBSFwQI1nwRKFdasDwLOmLliipQ/exec", // Default URL, will be updated during initialization
  SESSION_KEY: "jobAppAutomator_session"
};

// Initialize the auth module
function initAuth(apiUrl) {
  // Update API URL if provided
  if (apiUrl) {
    AUTH_CONFIG.API_URL = apiUrl;
    console.log("Auth module initialized with API URL:", apiUrl);
  }
  
  // Check localStorage for existing session
  const localSession = getLocalSession();
  
  // Synchronize localStorage and chrome.storage
  synchronizeSessions(localSession).then(session => {
    if (session) {
      console.log("Found existing session, validating...");
      // Validate existing session
      validateSession(session)
        .then(response => {
          if (response.success) {
            console.log("Session validated successfully");
            // Session valid, update UI
            updateAuthUI(true);
            // Fire event for session validation
            document.dispatchEvent(new CustomEvent('auth:validated', { 
              detail: { user: session }
            }));
            
            // Also dispatch event to notify popup
            try {
              chrome.runtime.sendMessage({
                action: "authStateChanged",
                isLoggedIn: true,
                session: session // Use the full session object, not just the response
              }).catch(err => console.log("Runtime message error:", err));
            } catch (err) {
              console.log("Failed to send message to runtime:", err);
            }
          } else {
            console.log("Session validation failed:", response.error);
            // Session invalid, clear it
            clearSession();
            updateAuthUI(false);
          }
        })
        .catch(error => {
          console.error("Session validation error:", error);
          clearSession();
          updateAuthUI(false);
        });
    } else {
      console.log("No existing session found");
      // No session, show login UI
      updateAuthUI(false);
    }
  });
  
  // Setup UI elements once DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAuthUI);
  } else {
    setupAuthUI();
  }
// Expose global API immediately so settings script can call methods
// even before initAuth is invoked
if (typeof window !== 'undefined') {
  window.JobAppAuth = {
    initAuth,
    showLoginModal: showLoginForm,
    showRegisterForm: showRegisterForm,
    hideAuthModal,
    login,
    register,
    validateSession,
    clearSession
  };
}
}

// Setup authentication UI elements
function setupAuthUI() {
  console.log("Setting up auth UI elements");
  
  // Create authentication modal
  createAuthModal();
  
  // Add authentication styles
  addAuthStyles();
  
  // Register event handlers
  const showLoginModalBtn = document.getElementById('showLoginBtn');
  if (showLoginModalBtn) {
    showLoginModalBtn.addEventListener('click', showLoginForm);
  }
  
  const showRegisterModalBtn = document.getElementById('showRegisterBtn');
  if (showRegisterModalBtn) {
    showRegisterModalBtn.addEventListener('click', showRegisterForm);
  }
  
  const logoutButton = document.getElementById('logoutBtn');
  if (logoutButton) {
    logoutButton.addEventListener('click', logout);
  }
  
  // Setup form submission handlers
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
    console.log("Login form submit handler registered");
  }
  
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegisterSubmit);
    console.log("Register form submit handler registered");
  }
  
  // Close modal handlers
  document.querySelectorAll('.auth-modal-close').forEach(btn => {
    btn.addEventListener('click', hideAuthModal);
  });
}

// Create authentication modal HTML
function createAuthModal() {
  if (document.getElementById('authModal')) {
    console.log("Auth modal already exists");
    return; // Already created
  }
  
  console.log("Creating auth modal");
  
  const modalHTML = `
  <div id="authModal" class="auth-modal hidden">
    <div class="auth-modal-content">
      <span class="auth-modal-close">&times;</span>
      
      <!-- Login Form -->
      <div id="loginFormContainer" class="auth-form-container">
        <h2><i class="fas fa-sign-in-alt"></i> Login</h2>
        <form id="loginForm" class="auth-form">
          <div class="auth-form-group">
            <label for="loginEmail">Email</label>
            <input type="email" id="loginEmail" name="email" required>
          </div>
          <div class="auth-form-group">
            <label for="loginPassword">Password</label>
            <input type="password" id="loginPassword" name="password" required>
          </div>
          <div class="auth-form-error" id="loginError"></div>
          <div class="auth-form-actions">
            <button type="submit" class="auth-btn-primary">Login</button>
            <button type="button" class="auth-btn-link" id="showRegisterBtn">Create Account</button>
          </div>
        </form>
      </div>
      
      <!-- Register Form -->
      <div id="registerFormContainer" class="auth-form-container hidden">
        <h2><i class="fas fa-user-plus"></i> Create Account</h2>
        <form id="registerForm" class="auth-form">
          <div class="auth-form-group">
            <label for="registerName">Full Name</label>
            <input type="text" id="registerName" name="name" required>
          </div>
          <div class="auth-form-group">
            <label for="registerEmail">Email</label>
            <input type="email" id="registerEmail" name="email" required>
          </div>
          <div class="auth-form-group">
            <label for="registerPassword">Password</label>
            <input type="password" id="registerPassword" name="password" required minlength="8">
            <div class="auth-password-hint">Must be at least 8 characters</div>
          </div>
          <div class="auth-form-error" id="registerError"></div>
          <div class="auth-form-actions">
            <button type="submit" class="auth-btn-primary">Create Account</button>
            <button type="button" class="auth-btn-link" id="showLoginBtn">Back to Login</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
  
  // Add modal to body
  const modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHTML;
  document.body.appendChild(modalContainer.firstElementChild);
  
  // Setup internal form toggle buttons
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', showRegisterForm);
    console.log("Register button event listener added");
  }
  
  const showLoginBtn = document.getElementById('showLoginBtn');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', showLoginForm);
    console.log("Login button event listener added");
  }
}

// Add authentication styles
function addAuthStyles() {
  if (document.getElementById('auth-styles')) {
    return; // Already added
  }
  
  const styleElement = document.createElement('style');
  styleElement.id = 'auth-styles';
  styleElement.textContent = `
    .auth-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      opacity: 1;
      transition: opacity 0.3s ease;
    }
    
    .auth-modal.hidden {
      opacity: 0;
      pointer-events: none;
    }
    
    .auth-modal-content {
      width: 90%;
      max-width: 350px;
      background: #1c1e26;
      border-radius: 12px;
      padding: 20px;
      position: relative;
      box-shadow: 0 5px 25px rgba(0, 0, 0, 0.5);
      color: #e3e3e3;
    }
    
    .auth-modal-close {
      position: absolute;
      top: 10px;
      right: 15px;
      font-size: 20px;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.6);
    }
    
    .auth-modal-close:hover {
      color: rgba(255, 255, 255, 0.9);
    }
    
    .auth-form-container {
      transition: all 0.3s ease;
    }
    
    .auth-form-container.hidden {
      display: none;
    }
    
    .auth-form-container h2 {
      margin-top: 0;
      margin-bottom: 20px;
      font-size: 18px;
      color: #e3e3e3;
      text-align: center;
    }
    
    .auth-form-group {
      margin-bottom: 15px;
    }
    
    .auth-form-group label {
      display: block;
      margin-bottom: 5px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
    }
    
    .auth-form-group input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      background-color: #2a2d39;
      color: #e3e3e3;
      font-size: 14px;
    }
    
    .auth-form-group input:focus {
      outline: none;
      border-color: #f0a830;
    }
    
    .auth-password-hint {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 5px;
    }
    
    .auth-form-error {
      color: #ff453a;
      font-size: 12px;
      margin-bottom: 15px;
      min-height: 15px;
      text-align: center;
    }
    
    .auth-form-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .auth-btn-primary {
      background-color: #f0a830;
      color: #1c1e26;
      border: none;
      border-radius: 6px;
      padding: 8px 15px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    
    .auth-btn-primary:hover {
      background-color: #d89726;
    }
    
    .auth-btn-link {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      font-size: 12px;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }
    
    .auth-btn-link:hover {
      color: #f0a830;
    }
    
    /* Header user info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background-color: rgba(255, 255, 255, 0.05);
      border-radius: 20px;
      margin-bottom: 10px;
      transition: all 0.2s;
    }
    
    .user-info:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    
    .user-avatar {
      width: 24px;
      height: 24px;
      background-color: #f0a830;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: #1c1e26;
    }
    
    .user-name {
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }
  `;
  
  document.head.appendChild(styleElement);
}

// Update UI based on auth state
function updateAuthUI(isLoggedIn) {
  console.log("Updating UI for auth state:", isLoggedIn);
  
  // Get user info if logged in
  const session = isLoggedIn ? getSession() : null;
  
  // Double-check session validity
  if (session) {
    // Ensure userTier is valid
    if (!session.userTier || !["FREE", "PAID", "BETA"].includes(session.userTier)) {
      console.log("Invalid userTier found: " + session.userTier + ". Setting to FREE.");
      session.userTier = "FREE";
      setSession(session);
    }
  }
  
  // Add user info to header
  const header = document.querySelector('.header');
  if (header) {
    // Remove existing user info
    const existingUserInfo = document.querySelector('.user-info');
    if (existingUserInfo) {
      existingUserInfo.remove();
    }
    
    if (isLoggedIn && session) {
      // Create user info element
      const userInfoHTML = `
        <div class="user-info">
          <div class="user-avatar">${session.name ? session.name.charAt(0).toUpperCase() : 'U'}</div>
          <div class="user-name">${session.name || 'User'}</div>
        </div>
      `;
      
      header.insertAdjacentHTML('beforeend', userInfoHTML);
      
      // Update subscription status
      const subscriptionStatus = document.querySelector('.subscription-status');
      if (subscriptionStatus) {
        subscriptionStatus.innerHTML = `<span>${session.applicationsRemaining || 0}</span> apps left`;
      }
    } else {
      // Update subscription status for logged out state
      const subscriptionStatus = document.querySelector('.subscription-status');
      if (subscriptionStatus) {
        subscriptionStatus.innerHTML = `<span>Sign in</span> to track apps`;
      }
    }
  }
  
  // Update navigation tabs
  const settingsTab = document.querySelector('.nav-tab[data-tab="settings"]');
  if (settingsTab) {
    settingsTab.innerHTML = isLoggedIn ? 
      '<i class="fas fa-user-circle"></i> Account' : 
      '<i class="fas fa-cog"></i> Settings';
  }
  
  // Update action buttons based on auth state
  if (isLoggedIn) {
    // Enable all functionality
    document.querySelectorAll('.primary-btn').forEach(btn => {
      btn.disabled = false;
    });
  } else {
    // Disable buttons that require auth
    const authRequiredButtons = [
      '#startBtn',
      '#detectOnlyBtn',
      '#saveContextBtn'
    ];
    
    authRequiredButtons.forEach(selector => {
      const btn = document.querySelector(selector);
      if (btn) {
        btn.disabled = true;
        btn.addEventListener('click', event => {
          if (!getSession()) {
            event.preventDefault();
            showAuthModal();
          }
        });
      }
    });
  }
  
  // Fire event for auth state change
  document.dispatchEvent(new CustomEvent('auth:stateChanged', { 
    detail: { isLoggedIn, user: session }
  }));
}

// Show authentication modal
function showAuthModal() {
  console.log("Showing auth modal");
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('hidden');
    showLoginForm(); // Default to login form
  } else {
    console.error("Auth modal not found!");
    // Create modal if it doesn't exist
    createAuthModal();
    setTimeout(() => {
      const newModal = document.getElementById('authModal');
      if (newModal) {
        newModal.classList.remove('hidden');
        showLoginForm();
      }
    }, 100);
  }
}

// Hide authentication modal
function hideAuthModal() {
  console.log("Hiding auth modal");
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('hidden');
    // Clear form errors
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = '';
    
    const registerError = document.getElementById('registerError');
    if (registerError) registerError.textContent = '';
    
    // Reset forms
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.reset();
    
    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.reset();
  }
}

// Show login form
function showLoginForm() {
  console.log("Showing login form");
  const loginForm = document.getElementById('loginFormContainer');
  const registerForm = document.getElementById('registerFormContainer');
  
  if (loginForm) loginForm.classList.remove('hidden');
  if (registerForm) registerForm.classList.add('hidden');
}

// Show register form
function showRegisterForm() {
  console.log("Showing register form");
  const loginForm = document.getElementById('loginFormContainer');
  const registerForm = document.getElementById('registerFormContainer');
  
  if (loginForm) loginForm.classList.add('hidden');
  if (registerForm) registerForm.classList.remove('hidden');
}

// Handle login form submission
function handleLoginSubmit(event) {
  event.preventDefault();
  console.log("Login form submitted");
  
  const emailField = document.getElementById('loginEmail');
  const passwordField = document.getElementById('loginPassword');
  const errorElement = document.getElementById('loginError');
  
  // Clear previous errors
  if (errorElement) errorElement.textContent = '';
  
  // Basic validation
  if (!emailField.value || !passwordField.value) {
    if (errorElement) errorElement.textContent = 'Please fill in all fields';
    return;
  }
  
  // Show loading state
  const submitButton = event.target.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;
  submitButton.textContent = 'Logging in...';
  submitButton.disabled = true;
  
  // Call login API
  login(emailField.value, passwordField.value)
    .then(response => {
      console.log("Login API response:", response);
      if (response.success) {
        // Validate userTier before storing
        if (!response.userTier || !["FREE", "PAID", "BETA"].includes(response.userTier)) {
          console.log("Invalid userTier in response: " + response.userTier + ". Setting to FREE.");
          response.userTier = "FREE";
        }
        
        // Store session and get the properly formatted session object
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
        
        // Store session
        setSession(sessionData);
        // Update UI
        updateAuthUI(true);
        // Hide modal
        hideAuthModal();
        
        // Also send an event to the background script to update state there with the properly formatted session
        try {
          chrome.runtime.sendMessage({
            action: "authStateChanged",
            isLoggedIn: true,
            session: sessionData
          }).catch(err => console.log("Runtime message error:", err));
        } catch (err) {
          console.log("Failed to send message to runtime:", err);
        }
      } else {
        if (errorElement) errorElement.textContent = response.error || 'Login failed';
      }
    })
    .catch(error => {
      console.error('Login error:', error);
      if (errorElement) errorElement.textContent = 'An error occurred. Please try again.';
    })
    .finally(() => {
      // Reset button state
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    });
}

// Handle register form submission
function handleRegisterSubmit(event) {
  event.preventDefault();
  console.log("Register form submitted");
  
  const nameField = document.getElementById('registerName');
  const emailField = document.getElementById('registerEmail');
  const passwordField = document.getElementById('registerPassword');
  const errorElement = document.getElementById('registerError');
  
  // Clear previous errors
  if (errorElement) errorElement.textContent = '';
  
  // Basic validation
  if (!nameField.value || !emailField.value || !passwordField.value) {
    if (errorElement) errorElement.textContent = 'Please fill in all fields';
    return;
  }
  
  if (passwordField.value.length < 8) {
    if (errorElement) errorElement.textContent = 'Password must be at least 8 characters';
    return;
  }
  
  // Show loading state
  const submitButton = event.target.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;
  submitButton.textContent = 'Creating account...';
  submitButton.disabled = true;
  
  // Call register API
  register(nameField.value, emailField.value, passwordField.value)
    .then(response => {
      console.log("Register API response:", response);
      if (response.success) {
        // Store session immediately
        setSession(response);
        // Update UI
        updateAuthUI(true);
        // Hide modal
        hideAuthModal();
      } else {
        if (errorElement) errorElement.textContent = response.error || 'Registration failed';
      }
    })
    .catch(error => {
      console.error('Registration error:', error);
      if (errorElement) errorElement.textContent = 'An error occurred. Please try again.';
    })
    .finally(() => {
      // Reset button state
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    });
}

// API Calls

// Login
async function login(email, password) {
  try {
    console.log(`Logging in user: ${email}`);
    const response = await fetch(AUTH_CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'login',
        email: email,
        password: password
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error('Login API error:', error);
    return { success: false, error: 'API request failed' };
  }
}

// Register
async function register(name, email, password) {
  try {
    console.log(`Registering new user: ${email}`);
    const response = await fetch(AUTH_CONFIG.API_URL, {
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
    });
    
    const data = await response.json();
    console.log("Registration response:", data);
    return data;
  } catch (error) {
    console.error('Register API error:', error);
    return { success: false, error: 'API request failed' };
  }
}

// File: auth.js
// Location: validateSession function

async function validateSession(session) {
  try {
    if (!session || !session.userId || !session.sessionToken) {
      console.error('Invalid session data:', session);
      return { success: false, error: 'Invalid session data' };
    }

    console.log(`Validating session for user: ${session.userId}`);
    
    // Check if token is near expiry
    const tokenExpiry = new Date(session.tokenExpiry);
    const now = new Date();
    const refreshNeeded = !tokenExpiry || tokenExpiry < now || (tokenExpiry - now) < 3600000; // 1 hour
    
    let url = `${AUTH_CONFIG.API_URL}?action=validateSession&userId=${session.userId}&sessionToken=${session.sessionToken}`;
    if (refreshNeeded) {
      url += '&refreshToken=true';
      console.log("Token needs refresh, requesting new token");
    }
    
    // Make request to validate/refresh token
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success) {
      // If we got new token information, update it
      if (data.sessionToken) {
        console.log("Received new session token");
        session.sessionToken = data.sessionToken;
        session.tokenExpiry = data.tokenExpiry;
      }
      
      // For any new or updated user info, update session
      if (data.userTier) session.userTier = data.userTier;
      if (data.applicationsRemaining !== undefined) session.applicationsRemaining = data.applicationsRemaining;
      if (data.tokenUsage !== undefined) session.tokenUsage = data.tokenUsage;
      if (data.userContext) session.userContext = data.userContext;
      
      // Save updated session
      setSession(session);
      
      // Return the full session data with success flag
      return {
        success: true,
        userId: session.userId,
        sessionToken: session.sessionToken,
        tokenExpiry: session.tokenExpiry,
        userTier: session.userTier,
        email: session.email,
        name: session.name,
        applicationsRemaining: session.applicationsRemaining,
        tokenUsage: session.tokenUsage,
        userContext: session.userContext
      };
    }
    
    console.error("Session validation failed:", data.error);
    return { success: false, error: data.error || 'Session validation failed' };
  } catch (error) {
    console.error("Error validating session:", error);
    return { success: false, error: 'Error validating session' };
  }
}

// Logout
function logout() {
  console.log("Logging out user");
  // Clear session data
  clearSession();
  // Update UI
  updateAuthUI(false);
  // Notify application
  document.dispatchEvent(new CustomEvent('auth:logout'));
}

// Session Management

// Get session from storage (primary function used by the app)
function getSession() {
  return getLocalSession();
}

// Helper function to get session from localStorage only
function getLocalSession() {
  try {
    const sessionData = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);
    if (sessionData) {
      return JSON.parse(sessionData);
    }
  } catch (error) {
    console.error('Error getting local session:', error);
  }
  return null;
}

// Helper function to get session from chrome.storage.local
async function getChromeSession() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['userSession'], (result) => {
        resolve(result.userSession || null);
      });
    } catch (error) {
      console.error('Error getting chrome session:', error);
      resolve(null);
    }
  });
}

// Synchronize sessions between localStorage and chrome.storage
async function synchronizeSessions(localSession) {
  try {
    const chromeSession = await getChromeSession();
    
    if (localSession && !chromeSession) {
      // localStorage has session but chrome.storage doesn't - sync to chrome
      console.log("Synchronizing session from localStorage to chrome.storage");
      chrome.storage.local.set({ userSession: localSession });
      return localSession;
    } 
    else if (!localSession && chromeSession) {
      // chrome.storage has session but localStorage doesn't - sync to localStorage
      console.log("Synchronizing session from chrome.storage to localStorage");
      localStorage.setItem(AUTH_CONFIG.SESSION_KEY, JSON.stringify(chromeSession));
      return chromeSession;
    } 
    else if (localSession && chromeSession) {
      // Both have sessions - use the one with the later expiry
      const localExpiry = new Date(localSession.tokenExpiry).getTime();
      const chromeExpiry = new Date(chromeSession.tokenExpiry).getTime();
      
      if (localExpiry > chromeExpiry) {
        console.log("Using localStorage session (more recent)");
        chrome.storage.local.set({ userSession: localSession });
        return localSession;
      } else {
        console.log("Using chrome.storage session (more recent)");
        localStorage.setItem(AUTH_CONFIG.SESSION_KEY, JSON.stringify(chromeSession));
        return chromeSession;
      }
    }
    
    // Neither has a session
    return null;
  } catch (error) {
    console.error("Error synchronizing sessions:", error);
    // Return whichever session exists
    return localSession || null;
  }
}

// Set session in storage
function setSession(data) {
  try {
    console.log("Storing session data:", data);
    
    // Use applicationsRemaining if available, otherwise calculate it
    let applicationsRemaining = data.applicationsRemaining;
    if (applicationsRemaining === undefined && data.userTier) {
      // Calculate based on tier if not provided
      if (data.userTier === 'BETA' && data.dynamicDailyLimit) {
        applicationsRemaining = data.dynamicDailyLimit.min;
      } else if (data.userTier === 'PAID') {
        applicationsRemaining = 25;
      } else {
        applicationsRemaining = 5; // FREE tier default
      }
    }
    
    const sessionData = {
      userId: data.userId,
      sessionToken: data.sessionToken,
      email: data.email,
      name: data.name,
      userTier: data.userTier || 'FREE',
      applicationsRemaining: applicationsRemaining || 0,
      tokenExpiry: data.tokenExpiry,
      tokenUsage: data.tokenUsage || 0,
      userContext: data.userContext || null,
      dynamicDailyLimit: data.dynamicDailyLimit
    };
    
    // Store in localStorage for popup usage
    localStorage.setItem(AUTH_CONFIG.SESSION_KEY, JSON.stringify(sessionData));
    console.log("Session data stored in localStorage successfully");
    
    // ALSO store in chrome.storage.local for background script usage
    try {
      chrome.storage.local.set({ userSession: sessionData }, () => {
        console.log("Session data also stored in chrome.storage.local for background access");
      });
    } catch (chromeError) {
      console.error('Error saving session to chrome.storage:', chromeError);
    }
    
    // Store other browser cache data for quick startup
    localStorage.setItem('jobAppAutomator_userEmail', data.email);
    localStorage.setItem('jobAppAutomator_userName', data.name);
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

// Clear session from storage
function clearSession() {
  try {
    // Clear from localStorage
    localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
    console.log("Session data cleared from localStorage");
    
    // Also clear from chrome.storage.local
    try {
      const keysToClear = [
        'userSession',
        'contextData',
        'resumeData', 'resumeFile', 'resumeFileData', 'resumeName', 'resumeType', 'resumeLastServerCheck',
        'currentCoverLetter', 'lastGeneratedCoverLetter',
        'coverLetterSettings', 'advancedSettings', 'autoOpenPopup',
        'tokenUsage', 'snapphil_logs', 'recentApplications', 'applicationHistory',
        'tempFileData', 'resumeTextContent'
      ];
      chrome.storage.local.remove(keysToClear, () => {
        console.log("All extension local storage cleared on logout");
      });
    } catch (chromeError) {
      console.error('Error clearing session from chrome.storage:', chromeError);
    }
  } catch (error) {
    console.error('Error clearing session:', error);
  }
}

// Export API for other scripts
window.JobAppAuth = {
  init: initAuth,
  getSession,
  isLoggedIn: () => !!getSession(),
  showLoginModal: showAuthModal,
  logout
};