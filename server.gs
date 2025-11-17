// Job Application Automator Backend
// Google Apps Script for authentication, resume storage, and application tracking
//
// ===================================================================================
// CEREBRAS AI SETUP INSTRUCTIONS:
// ===================================================================================
// 1. Get your Cerebras API key from: https://api.cerebras.ai/
// 2. In Google Apps Script, go to Project Settings (gear icon)
// 3. Click "Script Properties" and add:
//    - Property: CEREBRAS_API_KEY
//    - Value: csk-694krty582p3n5k6ykdk9vfjpprvcvk83d99eehdrevmt3mh (your actual key)
// 4. Save the properties
// 
// Note: This replaces the OpenAI API for testing purposes.
// The system now uses Cerebras AI's "qwen-3-32b" model instead of GPT-4.
// ===================================================================================

// Configuration
const CONFIG = {
  RESUME_FOLDER_NAME: "JobApplicationAutomator_Resumes",
  USER_SHEET_NAME: "Users",
  APPLICATION_SHEET_NAME: "Applications",
  RESUME_SHEET_NAME: "Resumes",
  COVER_LETTER_SHEET_NAME: "CoverLetters",
  SESSION_DURATION_HOURS: 720, // 24 hours x 30 days = 720 hours
  JWT_SECRET: "job-automator-secret-key", // Change for production
  TOKEN_USAGE_SHEET_NAME: "TokenUsage",
  USER_CONTEXT_SHEET_NAME: "UserContext",
  SUPPORT_QUERY_SHEET_NAME: "SupportQuery",
  DAILY_TIER_LIMITS: {
    "FREE": 5,   // FREE users get 5 applications per day
    "PAID": 25,  // PAID users get 25 applications per day
    "BETA": 15   // Default limit for BETA users
  },
  TOKENS_PER_APPLICATION: 10000,
  GLOBAL_TOKENS_SHEET_NAME: "GlobalTokens",
  INITIAL_GLOBAL_TOKENS: 95000000,
  VERSION: "1.3.0",
  USER_SETTINGS_SHEET_NAME: "UserSettings", // New sheet for user settings
  SUPPORT_SHEET_NAME: "Support",
  TOKEN_SHEET_NAME: "Tokens",
  FILES_FOLDER_NAME: "UserFiles"
};

// Utility function to log operations with timestamps
function logOperation(operation, details) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${operation}: ${JSON.stringify(details)}`);
}

// Create necessary sheets and folders on script initialization
function initializeDatabase() {
  try {
    logOperation("initializeDatabase", {status: "starting"});
    
    // Create or get spreadsheet
    let spreadsheet;
    const files = DriveApp.getFilesByName("JobApplicationAutomator_DB");
    if (files.hasNext()) {
      spreadsheet = SpreadsheetApp.open(files.next());
      logOperation("initializeDatabase", {status: "found existing database"});
    } else {
      spreadsheet = SpreadsheetApp.create("JobApplicationAutomator_DB");
      logOperation("initializeDatabase", {status: "created new database"});
    }
    
    // Create sheets if they don't exist
    createOrUpdateSheet(spreadsheet, CONFIG.USER_SHEET_NAME, [
      "userId", "email", "passwordHash", "name", "createdAt", 
      "lastLogin", "userTier", "sessionToken", "tokenExpiry", "tokenUsage"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.APPLICATION_SHEET_NAME, [
      "id", "userId", "jobTitle", "company", "appliedDate", 
      "status", "url", "resumeId", "coverLetterId", "tokenUsage", "dailyDate"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.RESUME_SHEET_NAME, [
      "id", "userId", "name", "fileId", "createdAt", "lastUpdated"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.COVER_LETTER_SHEET_NAME, [
      "id", "userId", "name", "fileId", "jobTitle", "company", "createdAt"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.TOKEN_USAGE_SHEET_NAME, [
      "id", "userId", "timestamp", "applicationId", "tokenCount", "description"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.USER_CONTEXT_SHEET_NAME, [
      "userId", "contextData", "updatedAt"
    ]);
    
    createOrUpdateSheet(spreadsheet, CONFIG.SUPPORT_QUERY_SHEET_NAME, [
      "id", "userId", "email", "name", "userTier", "subject", "message", "timestamp", "status", "browserInfo", "source"
    ]);
    
    // Create Global Tokens sheet
    let globalTokenSheet = spreadsheet.getSheetByName(CONFIG.GLOBAL_TOKENS_SHEET_NAME);
    if (!globalTokenSheet) {
      globalTokenSheet = spreadsheet.insertSheet(CONFIG.GLOBAL_TOKENS_SHEET_NAME);
      globalTokenSheet.appendRow(["timestamp", "tokensRemaining", "tokensUsed", "event", "userId"]);
      globalTokenSheet.appendRow([new Date().toISOString(), CONFIG.INITIAL_GLOBAL_TOKENS, 0, "Initial setup", ""]);
      logOperation("initializeDatabase", {status: "initialized global tokens", tokens: CONFIG.INITIAL_GLOBAL_TOKENS});
    }
    
    // Create folders for storing files
    if (!DriveApp.getFoldersByName(CONFIG.RESUME_FOLDER_NAME).hasNext()) {
      DriveApp.createFolder(CONFIG.RESUME_FOLDER_NAME);
      logOperation("initializeDatabase", {status: "created resume folder"});
    }
    
    logOperation("initializeDatabase", {status: "completed successfully"});
    return "Database initialized successfully";
  } catch (error) {
    logOperation("initializeDatabase", {status: "failed", error: error.toString()});
    throw new Error("Database initialization failed: " + error.toString());
  }
}

// Helper to create or update sheets with consistent headers
function createOrUpdateSheet(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  
  if (!sheet) {
    // Create new sheet with headers
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow(headers);
    logOperation("createOrUpdateSheet", {sheet: sheetName, status: "created"});
  } else {
    // Check if headers need updating
    const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Add any missing headers
    headers.forEach(header => {
      if (!currentHeaders.includes(header)) {
        // Add missing header
        sheet.getRange(1, currentHeaders.length + 1).setValue(header);
        currentHeaders.push(header);
        logOperation("createOrUpdateSheet", {
          sheet: sheetName, 
          status: "added missing header", 
          header: header
        });
      }
    });
  }
  
  return sheet;
}

// Utility function to get database spreadsheet
function getDatabase() {
  const files = DriveApp.getFilesByName("JobApplicationAutomator_DB");
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  throw new Error("Database not found. Run initializeDatabase() first.");
}

// Utility function to get folder
function getOrCreateUserFolder(userId) {
  try {
    const rootFolders = DriveApp.getFoldersByName(CONFIG.RESUME_FOLDER_NAME);
    if (!rootFolders.hasNext()) {
      throw new Error("Root folder not found. Run initializeDatabase() first.");
    }
    
    const rootFolder = rootFolders.next();
    const userFolders = rootFolder.getFoldersByName(userId);
    
    if (userFolders.hasNext()) {
      return userFolders.next();
    }
    
    // Create new user folder structure
    const userFolder = rootFolder.createFolder(userId);
    userFolder.createFolder("resumes");
    userFolder.createFolder("coverLetters");
    
    logOperation("getOrCreateUserFolder", {userId: userId, status: "created new folder"});
    return userFolder;
  } catch (error) {
    logOperation("getOrCreateUserFolder", {userId: userId, status: "failed", error: error.toString()});
    throw new Error("Failed to get or create user folder: " + error.toString());
  }
}

// Generate a secure hash for password
function hashPassword(password) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password));
}

// Generate secure session token
function generateSessionToken() {
  return Utilities.getUuid();
}

// Register a new user
function registerUser(email, password, name) {
  try {
    logOperation("registerUser", {email: email, status: "starting"});
    
    if (!email || !password || !name) {
      return {
        success: false,
        error: "Email, password, and name are required"
      };
    }
    
    const db = getDatabase();
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    // Check if email already exists
    const data = userSheet.getDataRange().getValues();
    const headerRow = data[0];
    const emailColIndex = headerRow.indexOf("email");
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailColIndex] === email) {
        logOperation("registerUser", {email: email, status: "email already exists"});
        return {
          success: false,
          error: "User with this email already exists"
        };
      }
    }
    
    // Get column indices for all fields
    const userIdColIndex = headerRow.indexOf("userId");
    const passwordHashColIndex = headerRow.indexOf("passwordHash");
    const nameColIndex = headerRow.indexOf("name");
    const createdAtColIndex = headerRow.indexOf("createdAt");
    const lastLoginColIndex = headerRow.indexOf("lastLogin");
    const userTierColIndex = headerRow.indexOf("userTier");
    const sessionTokenColIndex = headerRow.indexOf("sessionToken");
    const tokenExpiryColIndex = headerRow.indexOf("tokenExpiry");
    const tokenUsageColIndex = headerRow.indexOf("tokenUsage");
    
    // Generate values for new user
    const userId = Utilities.getUuid();
    const passwordHash = hashPassword(password);
    const createdAt = new Date().toISOString();
    const sessionToken = generateSessionToken();
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + CONFIG.SESSION_DURATION_HOURS);
    const userTier = "BETA"; // Default tier for new users
    const initialTokenUsage = 0;
    
    // Create new row with correctly positioned values
    const newRow = Array(headerRow.length).fill("");
    newRow[userIdColIndex] = userId;
    newRow[emailColIndex] = email;
    newRow[passwordHashColIndex] = passwordHash;
    newRow[nameColIndex] = name;
    newRow[createdAtColIndex] = createdAt;
    newRow[lastLoginColIndex] = createdAt;
    newRow[userTierColIndex] = userTier;
    newRow[sessionTokenColIndex] = sessionToken;
    newRow[tokenExpiryColIndex] = tokenExpiry.toISOString();
    newRow[tokenUsageColIndex] = initialTokenUsage;
    
    // Append the row
    userSheet.appendRow(newRow);
    
    // Create user folders
    getOrCreateUserFolder(userId);
    
    logOperation("registerUser", {
      email: email, 
      userId: userId, 
      status: "success",
      tier: userTier
    });
    
    return {
      success: true,
      userId: userId,
      email: email,
      name: name,
      sessionToken: sessionToken,
      tokenExpiry: tokenExpiry.toISOString(),
      userTier: userTier,
      tokenUsage: initialTokenUsage
    };
  } catch (error) {
    logOperation("registerUser", {email: email, status: "failed", error: error.toString()});
    return {
      success: false,
      error: "Registration failed: " + error.toString()
    };
  }
}

// Login user
function loginUser(email, password) {
  try {
    logOperation("loginUser", {email: email, status: "starting"});
    
    if (!email || !password) {
      return {
        success: false,
        error: "Email and password are required"
      };
    }
    
    const db = getDatabase();
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    const data = userSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const userIdColIndex = headerRow.indexOf("userId");
    const emailColIndex = headerRow.indexOf("email");
    const passwordHashColIndex = headerRow.indexOf("passwordHash");
    const nameColIndex = headerRow.indexOf("name");
    const lastLoginColIndex = headerRow.indexOf("lastLogin");
    const userTierColIndex = headerRow.indexOf("userTier");
    const sessionTokenColIndex = headerRow.indexOf("sessionToken");
    const tokenExpiryColIndex = headerRow.indexOf("tokenExpiry");
    const tokenUsageColIndex = headerRow.indexOf("tokenUsage");
    
    // Find user row
    let userRow = -1;
    let userData = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailColIndex] === email) {
        userRow = i + 1; // +1 because sheet rows are 1-indexed
        userData = data[i];
        break;
      }
    }
    
    if (userRow === -1) {
      logOperation("loginUser", {email: email, status: "user not found"});
      return {
        success: false,
        error: "User not found"
      };
    }
    
    const passwordHash = hashPassword(password);
    if (userData[passwordHashColIndex] !== passwordHash) {
      logOperation("loginUser", {email: email, status: "invalid password"});
      return {
        success: false,
        error: "Invalid password"
      };
    }
    
    // Generate new session data
    const sessionToken = generateSessionToken();
    const lastLogin = new Date().toISOString();
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + CONFIG.SESSION_DURATION_HOURS);
    
    // Check and set userTier if invalid
    let currentTier = userData[userTierColIndex];
    if (!currentTier || !["FREE", "PAID", "BETA"].includes(currentTier)) {
      currentTier = "BETA";
      userSheet.getRange(userRow, userTierColIndex + 1).setValue(currentTier);
      logOperation("loginUser", {
        email: email, 
        status: "fixed user tier", 
        oldTier: userData[userTierColIndex], 
        newTier: currentTier
      });
    }
    
    // Update user session data
    userSheet.getRange(userRow, lastLoginColIndex + 1).setValue(lastLogin);
    userSheet.getRange(userRow, sessionTokenColIndex + 1).setValue(sessionToken);
    userSheet.getRange(userRow, tokenExpiryColIndex + 1).setValue(tokenExpiry.toISOString());
    
    // Get token usage
    const tokenUsage = tokenUsageColIndex >= 0 ? (userData[tokenUsageColIndex] || 0) : 0;
    
    const userContext = getUserContextData(userData[userIdColIndex]);
    
    const userId = userData[userIdColIndex];
    logOperation("loginUser", {
      email: email, 
      userId: userId, 
      status: "success",
      tier: currentTier
    });
    
    return {
      success: true,
      userId: userId,
      email: userData[emailColIndex],
      name: userData[nameColIndex],
      sessionToken: sessionToken,
      tokenExpiry: tokenExpiry.toISOString(),
      userTier: currentTier,
      tokenUsage: tokenUsage,
      userContext: userContext || null,
      dynamicDailyLimit: currentTier === "BETA" ? calculateBetaDailyLimits() : undefined
    };
  } catch (error) {
    logOperation("loginUser", {email: email, status: "failed", error: error.toString()});
    return {
      success: false,
      error: "Login failed: " + error.toString()
    };
  }
}

// Validate session token
function validateSession(userId, sessionToken) {
  try {
    if (!userId || !sessionToken) {
      return {
        success: false,
        error: "User ID and session token are required"
      };
    }
    
    const db = getDatabase();
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    const data = userSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const userIdColIndex = headerRow.indexOf("userId");
    const emailColIndex = headerRow.indexOf("email");
    const nameColIndex = headerRow.indexOf("name");
    const sessionTokenColIndex = headerRow.indexOf("sessionToken");
    const tokenExpiryColIndex = headerRow.indexOf("tokenExpiry");
    const userTierColIndex = headerRow.indexOf("userTier");
    const tokenUsageColIndex = headerRow.indexOf("tokenUsage");
    
    // Find user row
    let userRow = -1;
    let userData = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdColIndex] === userId) {
        userRow = i + 1; // +1 because sheet rows are 1-indexed
        userData = data[i];
        break;
      }
    }
    
    if (userRow === -1) {
      logOperation("validateSession", {userId: userId, status: "user not found"});
      return {
        success: false,
        error: "User not found"
      };
    }
    
    // Validate session token
    const storedToken = userData[sessionTokenColIndex];
    
    if (storedToken !== sessionToken) {
      logOperation("validateSession", {
        userId: userId, 
        status: "token mismatch",
        expected: sessionToken,
        found: storedToken
      });
      return {
        success: false,
        error: "Invalid session token"
      };
    }
    
    // Check token expiry
    const tokenExpiry = new Date(userData[tokenExpiryColIndex]);
    
    if (tokenExpiry < new Date()) {
      // Generate new token and expiry
      const newToken = generateSessionToken();
      const newExpiry = new Date();
      newExpiry.setHours(newExpiry.getHours() + CONFIG.SESSION_DURATION_HOURS);
      
      // Update token in database
      userSheet.getRange(userRow, sessionTokenColIndex + 1).setValue(newToken);
      userSheet.getRange(userRow, tokenExpiryColIndex + 1).setValue(newExpiry.toISOString());
      
      logOperation("validateSession", {
        userId: userId, 
        status: "token refreshed",
        newTokenExpiry: newExpiry.toISOString()
      });
      
      // Get and validate user tier
      let userTier = userData[userTierColIndex] || "FREE";
      if (!["FREE", "PAID", "BETA"].includes(userTier)) {
        userTier = "BETA";
        userSheet.getRange(userRow, userTierColIndex + 1).setValue(userTier);
        
        logOperation("validateSession", {
          userId: userId, 
          status: "fixed user tier",
          oldTier: userData[userTierColIndex],
          newTier: userTier
        });
      }
      
      const userContext = getUserContextData(userId);
      
      return {
        success: true,
        userId: userData[userIdColIndex],
        email: userData[emailColIndex],
        name: userData[nameColIndex],
        sessionToken: newToken,
        tokenExpiry: newExpiry.toISOString(),
        userTier: userTier,
        tokenUsage: tokenUsageColIndex >= 0 ? (userData[tokenUsageColIndex] || 0) : 0,
        userContext: userContext || null,
        dynamicDailyLimit: userTier === "BETA" ? calculateBetaDailyLimits() : undefined,
        tokenRefreshed: true
      };
    }
    
    // Token still valid, return user data
    let userTier = userData[userTierColIndex] || "FREE";
    if (!["FREE", "PAID", "BETA"].includes(userTier)) {
      userTier = "BETA";
      userSheet.getRange(userRow, userTierColIndex + 1).setValue(userTier);
      
      logOperation("validateSession", {
        userId: userId, 
        status: "fixed user tier",
        oldTier: userData[userTierColIndex],
        newTier: userTier
      });
    }
    
    const userContext = getUserContextData(userId);
    
    return {
      success: true,
      userId: userData[userIdColIndex],
      email: userData[emailColIndex],
      name: userData[nameColIndex],
      userTier: userTier,
      tokenUsage: tokenUsageColIndex >= 0 ? (userData[tokenUsageColIndex] || 0) : 0,
      userContext: userContext || null,
      dynamicDailyLimit: userTier === "BETA" ? calculateBetaDailyLimits() : undefined
    };
  } catch (error) {
    logOperation("validateSession", {userId: userId, status: "failed", error: error.toString()});
    return {
      success: false,
      error: "Session validation failed: " + error.toString()
    };
  }
}

// Get user context data
function getUserContextData(userId) {
  try {
    if (!userId) {
      return null;
    }
    
    const db = getDatabase();
    const contextSheet = db.getSheetByName(CONFIG.USER_CONTEXT_SHEET_NAME);
    
    if (!contextSheet) return null;
    
    const data = contextSheet.getDataRange().getValues();
    const headerRow = data[0];
    const userIdColIndex = headerRow.indexOf("userId");
    const contextDataColIndex = headerRow.indexOf("contextData");
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdColIndex] === userId) {
        try {
          return JSON.parse(data[i][contextDataColIndex]);
        } catch (e) {
          logOperation("getUserContextData", {
            userId: userId, 
            status: "parse error", 
            error: e.toString()
          });
          return null;
        }
      }
    }
    return null;
  } catch (error) {
    logOperation("getUserContextData", {userId: userId, status: "failed", error: error.toString()});
    return null;
  }
}

// Update user context data
function updateUserContext(userId, sessionToken, contextData) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    const db = getDatabase();
    let contextSheet = db.getSheetByName(CONFIG.USER_CONTEXT_SHEET_NAME);
    
    if (!contextSheet) {
      contextSheet = createOrUpdateSheet(db, CONFIG.USER_CONTEXT_SHEET_NAME, [
        "userId", "contextData", "updatedAt"
      ]);
    }
    
    const data = contextSheet.getDataRange().getValues();
    const headerRow = data[0];
    const userIdColIndex = headerRow.indexOf("userId");
    const contextDataColIndex = headerRow.indexOf("contextData");
    const updatedAtColIndex = headerRow.indexOf("updatedAt");
    
    let contextRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdColIndex] === userId) {
        contextRow = i + 1;
        break;
      }
    }
    
    const now = new Date().toISOString();
    let contextJson;
    try {
      contextJson = JSON.stringify(contextData);
    } catch (e) {
      logOperation("updateUserContext", {
        userId: userId, 
        status: "json stringify error", 
        error: e.toString()
      });
      return {
        success: false,
        error: "Invalid context data format: " + e.toString()
      };
    }
    
    if (contextRow === -1) {
      // Create new row with properly positioned data
      const newRow = Array(headerRow.length).fill("");
      newRow[userIdColIndex] = userId;
      newRow[contextDataColIndex] = contextJson;
      newRow[updatedAtColIndex] = now;
      
      contextSheet.appendRow(newRow);
    } else {
      contextSheet.getRange(contextRow, contextDataColIndex + 1).setValue(contextJson);
      contextSheet.getRange(contextRow, updatedAtColIndex + 1).setValue(now);
    }
    
    logOperation("updateUserContext", {userId: userId, status: "success"});
    
    return {
      success: true,
      message: "User context updated successfully"
    };
  } catch (error) {
    logOperation("updateUserContext", {userId: userId, status: "failed", error: error.toString()});
    return {
      success: false,
      error: "Failed to update user context: " + error.toString()
    };
  }
}

// Track token usage for a user and update global tokens
function trackTokenUsage(userId, tokenCount, applicationId, description) {
  try {
    if (!userId || !tokenCount) {
      return {
        success: false,
        error: "User ID and token count are required"
      };
    }
    
    const db = getDatabase();
    const tokenSheet = db.getSheetByName(CONFIG.TOKEN_USAGE_SHEET_NAME);
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    // Prepare token usage entry
    const tokenId = Utilities.getUuid();
    const timestamp = new Date().toISOString();
    
    // Get token sheet column indices
    const tokenData = tokenSheet.getDataRange().getValues();
    const tokenHeaderRow = tokenData[0];
    const tokenIdColIndex = tokenHeaderRow.indexOf("id");
    const tokenUserIdColIndex = tokenHeaderRow.indexOf("userId");
    const tokenTimestampColIndex = tokenHeaderRow.indexOf("timestamp");
    const tokenApplicationIdColIndex = tokenHeaderRow.indexOf("applicationId");
    const tokenCountColIndex = tokenHeaderRow.indexOf("tokenCount");
    const tokenDescriptionColIndex = tokenHeaderRow.indexOf("description");
    
    // Create token usage row with properly positioned data
    const newTokenRow = Array(tokenHeaderRow.length).fill("");
    newTokenRow[tokenIdColIndex] = tokenId;
    newTokenRow[tokenUserIdColIndex] = userId;
    newTokenRow[tokenTimestampColIndex] = timestamp;
    newTokenRow[tokenApplicationIdColIndex] = applicationId || "";
    newTokenRow[tokenCountColIndex] = tokenCount;
    newTokenRow[tokenDescriptionColIndex] = description || "API call";
    
    tokenSheet.appendRow(newTokenRow);
    
    // Update user's total token usage
    const userData = userSheet.getDataRange().getValues();
    const userHeaderRow = userData[0];
    const userIdColIndex = userHeaderRow.indexOf("userId");
    const tokenUsageColIndex = userHeaderRow.indexOf("tokenUsage");
    
    // Find user row
    let userRow = -1;
    let currentTokenUsage = 0;
    
    for (let i = 1; i < userData.length; i++) {
      if (userData[i][userIdColIndex] === userId) {
        userRow = i + 1;
        currentTokenUsage = tokenUsageColIndex >= 0 && userData[i][tokenUsageColIndex] ? 
                           Number(userData[i][tokenUsageColIndex]) : 0;
        break;
      }
    }
    
    if (userRow === -1) {
      logOperation("trackTokenUsage", {userId: userId, status: "user not found"});
      return {
        success: false,
        error: "User not found"
      };
    }
    
    // Handle tokenUsage column
    if (tokenUsageColIndex >= 0) {
      userSheet.getRange(userRow, tokenUsageColIndex + 1).setValue(currentTokenUsage + tokenCount);
    } else {
      // If tokenUsage column doesn't exist, add it
      const lastCol = userHeaderRow.length + 1;
      userSheet.getRange(1, lastCol).setValue("tokenUsage");
      userSheet.getRange(userRow, lastCol).setValue(currentTokenUsage + tokenCount);
      
      logOperation("trackTokenUsage", {
        userId: userId, 
        status: "added missing tokenUsage column"
      });
    }
    
    // Update global tokens pool
    updateGlobalTokenPool(tokenCount, description || "Token consumption", userId);
    
    logOperation("trackTokenUsage", {
      userId: userId, 
      tokenCount: tokenCount, 
      applicationId: applicationId,
      newTotal: currentTokenUsage + tokenCount,
      status: "success"
    });
    
    return {
      success: true,
      userId: userId,
      tokenUsage: currentTokenUsage + tokenCount
    };
  } catch (error) {
    logOperation("trackTokenUsage", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to track token usage: " + error.toString()
    };
  }
}

// Get the global tokens sheet
function getGlobalTokensSheet() {
  try {
    const db = getDatabase();
    let sheet = db.getSheetByName(CONFIG.GLOBAL_TOKENS_SHEET_NAME);
    
    if (!sheet) {
      sheet = db.insertSheet(CONFIG.GLOBAL_TOKENS_SHEET_NAME);
      sheet.appendRow(["timestamp", "tokensRemaining", "tokensUsed", "event", "userId"]);
      sheet.appendRow([new Date().toISOString(), CONFIG.INITIAL_GLOBAL_TOKENS, 0, "Initial setup", ""]);
      
      logOperation("getGlobalTokensSheet", {
        status: "created sheet", 
        initialTokens: CONFIG.INITIAL_GLOBAL_TOKENS
      });
    }
    
    // Verify the sheet has at least the initial row
    if (sheet.getLastRow() < 2) {
      sheet.appendRow([new Date().toISOString(), CONFIG.INITIAL_GLOBAL_TOKENS, 0, "Reset global tokens", ""]);
      
      logOperation("getGlobalTokensSheet", {
        status: "reset tokens", 
        initialTokens: CONFIG.INITIAL_GLOBAL_TOKENS
      });
    }
    
    return sheet;
  } catch (error) {
    logOperation("getGlobalTokensSheet", {status: "failed", error: error.toString()});
    throw new Error("Failed to get global tokens sheet: " + error.toString());
  }
}

// Update the global tokens pool by subtracting tokens consumed
function updateGlobalTokenPool(tokenCount, event, userId) {
  try {
    if (!tokenCount) return;
    
    // Ensure tokenCount is a number
    tokenCount = Number(tokenCount);
    if (isNaN(tokenCount) || tokenCount <= 0) return;
    
    var globalSheet = getGlobalTokensSheet();
    var lastRow = globalSheet.getLastRow();
    
    // Get the current tokens remaining
    var currentTokensRemaining = 0;
    if (lastRow < 2) {
      currentTokensRemaining = CONFIG.INITIAL_GLOBAL_TOKENS;
    } else {
      currentTokensRemaining = parseInt(globalSheet.getRange(lastRow, 2).getValue()) || 0;
      
      // Validate tokens remaining
      if (isNaN(currentTokensRemaining)) {
        currentTokensRemaining = CONFIG.INITIAL_GLOBAL_TOKENS;
        logOperation("updateGlobalTokenPool", {
          status: "reset invalid tokens", 
          tokens: CONFIG.INITIAL_GLOBAL_TOKENS
        });
      }
    }
    
    var newTokensRemaining = currentTokensRemaining - tokenCount;
    if (newTokensRemaining < 0) newTokensRemaining = 0;
    
    globalSheet.appendRow([new Date().toISOString(), newTokensRemaining, tokenCount, event, userId || ""]);
    
    logOperation("updateGlobalTokenPool", {
      tokens: tokenCount,
      remaining: newTokensRemaining,
      event: event,
      userId: userId,
      status: "success"
    });
  } catch (error) {
    logOperation("updateGlobalTokenPool", {
      status: "failed", 
      error: error.toString(),
      tokens: tokenCount
    });
  }
}

// Get all user applications with resource information and daily statistics
function getUserApplications(userId, sessionToken) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    const db = getDatabase();
    const appSheet = db.getSheetByName(CONFIG.APPLICATION_SHEET_NAME);
    const resumeSheet = db.getSheetByName(CONFIG.RESUME_SHEET_NAME);
    const coverLetterSheet = db.getSheetByName(CONFIG.COVER_LETTER_SHEET_NAME);
    
    // Get data and headers
    const appData = appSheet.getDataRange().getValues();
    const resumeData = resumeSheet.getDataRange().getValues();
    const coverLetterData = coverLetterSheet.getDataRange().getValues();
    
    const appHeaderRow = appData[0];
    const resumeHeaderRow = resumeData[0];
    const coverHeaderRow = coverLetterData[0];
    
    // Get column indices for application sheet
    const appIdColIndex = appHeaderRow.indexOf("id");
    const appUserIdColIndex = appHeaderRow.indexOf("userId");
    const appJobTitleColIndex = appHeaderRow.indexOf("jobTitle");
    const appCompanyColIndex = appHeaderRow.indexOf("company");
    const appDateColIndex = appHeaderRow.indexOf("appliedDate");
    const appStatusColIndex = appHeaderRow.indexOf("status");
    const appUrlColIndex = appHeaderRow.indexOf("url");
    const appResumeIdColIndex = appHeaderRow.indexOf("resumeId");
    const appCoverLetterIdColIndex = appHeaderRow.indexOf("coverLetterId");
    const appTokenUsageColIndex = appHeaderRow.indexOf("tokenUsage");
    const appDailyDateColIndex = appHeaderRow.indexOf("dailyDate");
    
    // Get column indices for resume sheet
    const resumeIdColIndex = resumeHeaderRow.indexOf("id");
    const resumeNameColIndex = resumeHeaderRow.indexOf("name");
    const resumeFileIdColIndex = resumeHeaderRow.indexOf("fileId");
    
    // Get column indices for cover letter sheet
    const coverIdColIndex = coverHeaderRow.indexOf("id");
    const coverNameColIndex = coverHeaderRow.indexOf("name");
    const coverFileIdColIndex = coverHeaderRow.indexOf("fileId");
    const coverJobTitleColIndex = coverHeaderRow.indexOf("jobTitle");
    const coverCompanyColIndex = coverHeaderRow.indexOf("company");
    
    // Build lookup maps for resumes and cover letters
    const resumeMap = {};
    for (let i = 1; i < resumeData.length; i++) {
      const resumeId = resumeData[i][resumeIdColIndex];
      if (resumeId) {
        try {
          const fileId = resumeData[i][resumeFileIdColIndex];
          const file = DriveApp.getFileById(fileId);
          resumeMap[resumeId] = {
            name: resumeData[i][resumeNameColIndex],
            url: file.getUrl(),
            downloadUrl: file.getDownloadUrl()
          };
        } catch (e) {
          logOperation("getUserApplications", {
            userId: userId, 
            status: "resume file access error", 
            resumeId: resumeId,
            error: e.toString()
          });
        }
      }
    }
    
    const coverLetterMap = {};
    for (let i = 1; i < coverLetterData.length; i++) {
      const coverLetterId = coverLetterData[i][coverIdColIndex];
      if (coverLetterId) {
        try {
          const fileId = coverLetterData[i][coverFileIdColIndex];
          const file = DriveApp.getFileById(fileId);
          coverLetterMap[coverLetterId] = {
            name: coverLetterData[i][coverNameColIndex],
            jobTitle: coverLetterData[i][coverJobTitleColIndex],
            company: coverLetterData[i][coverCompanyColIndex],
            url: file.getUrl(),
            downloadUrl: file.getDownloadUrl()
          };
        } catch (e) {
          logOperation("getUserApplications", {
            userId: userId, 
            status: "cover letter file access error", 
            coverLetterId: coverLetterId,
            error: e.toString()
          });
        }
      }
    }
    
    // Build applications list and daily stats
    const applications = [];
    const dailyStats = {};
    
    for (let i = 1; i < appData.length; i++) {
      if (appData[i][appUserIdColIndex] === userId) {
        const application = {
          id: appData[i][appIdColIndex],
          jobTitle: appData[i][appJobTitleColIndex],
          company: appData[i][appCompanyColIndex],
          appliedDate: appData[i][appDateColIndex],
          status: appData[i][appStatusColIndex],
          url: appData[i][appUrlColIndex],
          resumeId: appData[i][appResumeIdColIndex],
          coverLetterId: appData[i][appCoverLetterIdColIndex]
        };
        
        // Handle daily date 
        let dailyDate = "";
        if (appDailyDateColIndex >= 0 && appData[i][appDailyDateColIndex]) {
          dailyDate = appData[i][appDailyDateColIndex];
          application.dailyDate = dailyDate;
          
          if (!dailyStats[dailyDate]) {
            dailyStats[dailyDate] = {
              count: 0,
              applications: []
            };
          }
          dailyStats[dailyDate].count++;
          dailyStats[dailyDate].applications.push(application.id);
        } else if (application.appliedDate) {
          // Create daily date from appliedDate if not explicitly set
          const dateObj = new Date(application.appliedDate);
          dailyDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
          application.dailyDate = dailyDate;
          
          if (!dailyStats[dailyDate]) {
            dailyStats[dailyDate] = {
              count: 0,
              applications: []
            };
          }
          dailyStats[dailyDate].count++;
          dailyStats[dailyDate].applications.push(application.id);
        }
        
        // Add token usage if available
        if (appTokenUsageColIndex >= 0) {
          application.tokenUsage = appData[i][appTokenUsageColIndex] || 0;
        }
        
        // Add resume and cover letter details if available
        if (application.resumeId && resumeMap[application.resumeId]) {
          application.resume = resumeMap[application.resumeId];
        }
        
        if (application.coverLetterId && coverLetterMap[application.coverLetterId]) {
          application.coverLetter = coverLetterMap[application.coverLetterId];
        }
        
        applications.push(application);
      }
    }
    
    // Format daily applications for response
    const dailyApplications = Object.keys(dailyStats).map(date => ({
      date,
      count: dailyStats[date].count,
      applications: dailyStats[date].applications
    }));
    
    // Sort by date descending
    dailyApplications.sort((a, b) => b.date.localeCompare(a.date));
    
    logOperation("getUserApplications", {
      userId: userId, 
      applicationCount: applications.length,
      dailyCount: dailyApplications.length,
      status: "success"
    });
    
    return {
      success: true,
      applications: applications,
      dailyApplications: dailyApplications
    };
  } catch (error) {
    logOperation("getUserApplications", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to get applications: " + error.toString()
    };
  }
}

// Calculate dynamic daily limits for BETA users
function calculateBetaDailyLimits() {
  try {
    var lowerTokenPerApp = 10000;
    var upperTokenPerApp = 15000;
    
    var globalSheet = getGlobalTokensSheet();
    var lastRow = globalSheet.getLastRow();
    var tokensRemaining = 0;
    
    if (lastRow < 2) {
      // Initialize global tokens if empty
      tokensRemaining = CONFIG.INITIAL_GLOBAL_TOKENS;
      globalSheet.appendRow([new Date().toISOString(), tokensRemaining, 0, "Initial setup", ""]);
    } else {
      try {
        tokensRemaining = parseInt(globalSheet.getRange(lastRow, 2).getValue());
      } catch (e) {
        logOperation("calculateBetaDailyLimits", {
          status: "tokens remaining error", 
          error: e.toString()
        });
        tokensRemaining = CONFIG.INITIAL_GLOBAL_TOKENS;
      }
    }
    
    // Add safety for token calculation
    if (isNaN(tokensRemaining) || tokensRemaining <= 0) {
      logOperation("calculateBetaDailyLimits", {
        status: "invalid tokens remaining", 
        value: tokensRemaining
      });
      tokensRemaining = 1000000; // Fallback default
    }
    
    var overallLowerApps = Math.floor(tokensRemaining / lowerTokenPerApp);
    var overallUpperApps = Math.floor(tokensRemaining / upperTokenPerApp);
    
    var db = getDatabase();
    var userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    var data = userSheet.getDataRange().getValues();
    var betaCount = 0;
    var headerRow = data[0];
    var tierIndex = headerRow.indexOf("userTier");
    
    // If we can't find the tier column, use default limits
    if (tierIndex === -1) {
      logOperation("calculateBetaDailyLimits", {
        status: "userTier column not found", 
        defaultLimits: {min: 10, max: 20}
      });
      return {min: 10, max: 20};
    }
    
    for (var i = 1; i < data.length; i++) {
      var userTierValue = data[i][tierIndex] ? String(data[i][tierIndex]).trim().toUpperCase() : "";
      if (userTierValue === "BETA") {
        betaCount++;
      }
    }
    
    // Always provide reasonable defaults, even if no BETA users are found
    if (betaCount === 0) {
      logOperation("calculateBetaDailyLimits", {
        status: "no BETA users found", 
        defaultLimits: {min: 10, max: 20}
      });
      return {min: 10, max: 20}; 
    }
    
    var minDaily = Math.floor(overallLowerApps / betaCount);
    var maxDaily = Math.floor(overallUpperApps / betaCount);
    
    // Ensure reasonable minimum values
    if (minDaily < 5) minDaily = 5;  
    if (maxDaily < 10) maxDaily = 10;
    
    logOperation("calculateBetaDailyLimits", {
      status: "success", 
      betaUserCount: betaCount,
      tokensRemaining: tokensRemaining,
      limits: {min: minDaily, max: maxDaily}
    });
    
    return {min: minDaily, max: maxDaily};
  } catch (error) {
    logOperation("calculateBetaDailyLimits", {status: "failed", error: error.toString()});
    // Return reasonable defaults in case of error
    return {min: 8, max: 15};
  }
}

// Track a new application
function trackApplication(userId, sessionToken, applicationData) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    // Validate required fields
    if (!applicationData.jobTitle || !applicationData.company) {
      return {
        success: false,
        error: "Job title and company are required"
      };
    }
    
    const db = getDatabase();
    const appSheet = db.getSheetByName(CONFIG.APPLICATION_SHEET_NAME);
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    // Get user data to check tier and limit
    const userData = userSheet.getDataRange().getValues();
    const userHeaderRow = userData[0];
    const userIdColIndex = userHeaderRow.indexOf("userId");
    const userTierColIndex = userHeaderRow.indexOf("userTier");
    
    // Find user row and get tier
    let userRow = -1;
    let userTier = "FREE";
    
    for (let i = 1; i < userData.length; i++) {
      if (userData[i][userIdColIndex] === userId) {
        userRow = i + 1;
        userTier = userTierColIndex >= 0 ? userData[i][userTierColIndex] : "FREE";
        break;
      }
    }
    
    if (userRow === -1) {
      logOperation("trackApplication", {
        userId: userId, 
        status: "user not found"
      });
      return {
        success: false,
        error: "User not found"
      };
    }
    
    // Determine daily limit based on user tier
    let dailyLimit;
    let dynamicLimits;
    
    if (userTier === "BETA") {
      dynamicLimits = calculateBetaDailyLimits();
      dailyLimit = dynamicLimits.min;
    } else {
      dailyLimit = CONFIG.DAILY_TIER_LIMITS[userTier] || CONFIG.DAILY_TIER_LIMITS.FREE;
    }
    
    // Check if daily limit reached
    const today = new Date();
    const todayFormatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Get application data and headers
    const appData = appSheet.getDataRange().getValues();
    const appHeaderRow = appData[0];
    
    // Get application column indices
    const appUserIdColIndex = appHeaderRow.indexOf("userId");
    const appDailyDateColIndex = appHeaderRow.indexOf("dailyDate");
    
    // Count today's applications
    let todayApplicationCount = 0;
    
    if (appDailyDateColIndex >= 0) {
      for (let i = 1; i < appData.length; i++) {
        if (appData[i][appUserIdColIndex] === userId && appData[i][appDailyDateColIndex] === todayFormatted) {
          todayApplicationCount++;
        }
      }
    }
    
    if (todayApplicationCount >= dailyLimit) {
      logOperation("trackApplication", {
        userId: userId, 
        status: "daily limit reached",
        limit: dailyLimit,
        count: todayApplicationCount
      });
      
      return {
        success: false,
        error: `Daily application limit reached (${dailyLimit} per day). Please try again tomorrow.`
      };
    }
    
    // Prepare new application data
    const applicationId = Utilities.getUuid();
    const tokenUsage = applicationData.tokenUsage || 0;
    const appliedDate = applicationData.appliedDate || new Date().toISOString();
    
    // Get all column indices
    const appIdColIndex = appHeaderRow.indexOf("id");
    const appJobTitleColIndex = appHeaderRow.indexOf("jobTitle");
    const appCompanyColIndex = appHeaderRow.indexOf("company");
    const appDateColIndex = appHeaderRow.indexOf("appliedDate");
    const appStatusColIndex = appHeaderRow.indexOf("status");
    const appUrlColIndex = appHeaderRow.indexOf("url");
    const appResumeIdColIndex = appHeaderRow.indexOf("resumeId");
    const appCoverLetterIdColIndex = appHeaderRow.indexOf("coverLetterId");
    const appTokenUsageColIndex = appHeaderRow.indexOf("tokenUsage");
    
    // Create new row with properly positioned data
    const newRow = Array(Math.max(appHeaderRow.length, appDailyDateColIndex + 1)).fill("");
    newRow[appIdColIndex] = applicationId;
    newRow[appUserIdColIndex] = userId;
    newRow[appJobTitleColIndex] = applicationData.jobTitle;
    newRow[appCompanyColIndex] = applicationData.company;
    newRow[appDateColIndex] = appliedDate;
    newRow[appStatusColIndex] = applicationData.status || "applied";
    newRow[appUrlColIndex] = applicationData.url || "";
    newRow[appResumeIdColIndex] = applicationData.resumeId || "";
    newRow[appCoverLetterIdColIndex] = applicationData.coverLetterId || "";
    
    if (appTokenUsageColIndex >= 0) {
      newRow[appTokenUsageColIndex] = tokenUsage;
    }
    
    if (appDailyDateColIndex >= 0) {
      newRow[appDailyDateColIndex] = todayFormatted;
    } else {
      // Add dailyDate column if it doesn't exist
      appSheet.getRange(1, appHeaderRow.length + 1).setValue("dailyDate");
      newRow.push(todayFormatted);
      
      logOperation("trackApplication", {
        userId: userId, 
        status: "added missing dailyDate column"
      });
    }
    
    // Add the new application
    appSheet.appendRow(newRow);
    
    // Track token usage
    if (tokenUsage > 0) {
      trackTokenUsage(userId, tokenUsage, applicationId, "Application submission");
    }
    
    logOperation("trackApplication", {
      userId: userId, 
      applicationId: applicationId,
      company: applicationData.company,
      jobTitle: applicationData.jobTitle,
      status: "success"
    });
    
    var responseObj = {
      success: true,
      applicationId: applicationId,
      dailyDate: todayFormatted,
      dailyLimit: dailyLimit,
      dailyRemaining: dailyLimit - todayApplicationCount - 1
    };
    
    if (userTier === "BETA") {
      responseObj.dynamicDailyLimit = dynamicLimits;
    }
    
    return responseObj;
  } catch (error) {
    logOperation("trackApplication", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to track application: " + error.toString()
    };
  }
}

// Update application status
function updateApplicationStatus(userId, sessionToken, applicationId, newStatus) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    if (!applicationId || !newStatus) {
      return {
        success: false,
        error: "Application ID and new status are required"
      };
    }
    
    const db = getDatabase();
    const appSheet = db.getSheetByName(CONFIG.APPLICATION_SHEET_NAME);
    
    const data = appSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const appIdColIndex = headerRow.indexOf("id");
    const appUserIdColIndex = headerRow.indexOf("userId");
    const appStatusColIndex = headerRow.indexOf("status");
    
    // Find application row
    let appRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][appIdColIndex] === applicationId && data[i][appUserIdColIndex] === userId) {
        appRow = i + 1;
        break;
      }
    }
    
    if (appRow === -1) {
      logOperation("updateApplicationStatus", {
        userId: userId, 
        applicationId: applicationId,
        status: "application not found"
      });
      
      return {
        success: false,
        error: "Application not found or you don't have permission to update it"
      };
    }
    
    const validStatuses = ["applied", "interview", "offer", "rejected"];
    if (!validStatuses.includes(newStatus)) {
      logOperation("updateApplicationStatus", {
        userId: userId, 
        applicationId: applicationId,
        status: "invalid status",
        requestedStatus: newStatus
      });
      
      return {
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(", ")
      };
    }
    
    appSheet.getRange(appRow, appStatusColIndex + 1).setValue(newStatus);
    
    logOperation("updateApplicationStatus", {
      userId: userId, 
      applicationId: applicationId,
      newStatus: newStatus,
      status: "success"
    });
    
    return {
      success: true,
      applicationId: applicationId,
      status: newStatus
    };
  } catch (error) {
    logOperation("updateApplicationStatus", {
      userId: userId, 
      applicationId: applicationId,
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to update application status: " + error.toString()
    };
  }
}

// Upload resume
function uploadResume(userId, sessionToken, fileData, fileName, fileType) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    if (!fileData || !fileName) {
      return {
        success: false,
        error: "File data and file name are required"
      };
    }
    
    const userFolder = getOrCreateUserFolder(userId);
    const resumesFolders = userFolder.getFoldersByName("resumes");
    
    if (!resumesFolders.hasNext()) {
      userFolder.createFolder("resumes");
      logOperation("uploadResume", {
        userId: userId, 
        status: "created missing resumes folder"
      });
    }
    
    const resumesFolder = resumesFolders.hasNext() ? 
                         resumesFolders.next() : 
                         userFolder.createFolder("resumes");
    
    const contentType = fileType || "application/pdf";
    
    // Handle base64 data with/without prefix
    let decoded;
    if (fileData.indexOf(',') !== -1) {
      decoded = Utilities.base64Decode(fileData.split(',')[1]);
    } else {
      decoded = Utilities.base64Decode(fileData);
    }
    
    const blob = Utilities.newBlob(decoded, contentType, fileName);
    
    const db = getDatabase();
    const resumeSheet = db.getSheetByName(CONFIG.RESUME_SHEET_NAME);
    const data = resumeSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const resumeIdColIndex = headerRow.indexOf("id");
    const resumeUserIdColIndex = headerRow.indexOf("userId");
    const resumeNameColIndex = headerRow.indexOf("name");
    const resumeFileIdColIndex = headerRow.indexOf("fileId");
    const resumeCreatedAtColIndex = headerRow.indexOf("createdAt");
    const resumeLastUpdatedColIndex = headerRow.indexOf("lastUpdated");
    
    // Check if user already has a resume
    let existingRow = -1;
    let existingFileId = null;
    let existingResumeId = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][resumeUserIdColIndex] === userId) {
        existingRow = i + 1;
        existingFileId = data[i][resumeFileIdColIndex];
        existingResumeId = data[i][resumeIdColIndex];
        break;
      }
    }
    
    // Remove old file if exists
    if (existingFileId) {
      try {
        DriveApp.getFileById(existingFileId).setTrashed(true);
        logOperation("uploadResume", {
          userId: userId, 
          status: "removed old file",
          oldFileId: existingFileId
        });
      } catch (e) {
        logOperation("uploadResume", {
          userId: userId, 
          status: "could not remove old file",
          oldFileId: existingFileId,
          error: e.toString()
        });
      }
    }
    
    // Create new file
    const file = resumesFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    const now = new Date().toISOString();
    
    if (existingRow > 0) {
      // Update existing resume
      resumeSheet.getRange(existingRow, resumeNameColIndex + 1).setValue(fileName);
      resumeSheet.getRange(existingRow, resumeFileIdColIndex + 1).setValue(file.getId());
      resumeSheet.getRange(existingRow, resumeLastUpdatedColIndex + 1).setValue(now);
      
      logOperation("uploadResume", {
        userId: userId, 
        resumeId: existingResumeId,
        fileName: fileName,
        status: "updated existing resume"
      });
      
      return {
        success: true,
        resumeId: existingResumeId,
        fileName: fileName,
        fileId: file.getId(),
        url: file.getUrl(),
        downloadUrl: file.getDownloadUrl()
      };
    } else {
      // Create new resume record
      const resumeId = Utilities.getUuid();
      
      // Create new row with properly positioned data
      const newRow = Array(headerRow.length).fill("");
      newRow[resumeIdColIndex] = resumeId;
      newRow[resumeUserIdColIndex] = userId;
      newRow[resumeNameColIndex] = fileName;
      newRow[resumeFileIdColIndex] = file.getId();
      newRow[resumeCreatedAtColIndex] = now;
      newRow[resumeLastUpdatedColIndex] = now;
      
      resumeSheet.appendRow(newRow);
      
      logOperation("uploadResume", {
        userId: userId, 
        resumeId: resumeId,
        fileName: fileName,
        status: "created new resume"
      });
      
      return {
        success: true,
        resumeId: resumeId,
        fileName: fileName,
        fileId: file.getId(),
        url: file.getUrl(),
        downloadUrl: file.getDownloadUrl()
      };
    }
  } catch (error) {
    logOperation("uploadResume", {
      userId: userId, 
      fileName: fileName,
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to upload resume: " + error.toString()
    };
  }
}

// Get user's resumes
function getUserResumes(userId, sessionToken) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    const db = getDatabase();
    const resumeSheet = db.getSheetByName(CONFIG.RESUME_SHEET_NAME);
    
    const data = resumeSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const resumeIdColIndex = headerRow.indexOf("id");
    const resumeUserIdColIndex = headerRow.indexOf("userId");
    const resumeNameColIndex = headerRow.indexOf("name");
    const resumeFileIdColIndex = headerRow.indexOf("fileId");
    const resumeCreatedAtColIndex = headerRow.indexOf("createdAt");
    const resumeLastUpdatedColIndex = headerRow.indexOf("lastUpdated");
    
    const resumes = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][resumeUserIdColIndex] === userId) {
        try {
          const fileId = data[i][resumeFileIdColIndex];
          const file = DriveApp.getFileById(fileId);
          
          resumes.push({
            id: data[i][resumeIdColIndex],
            name: data[i][resumeNameColIndex],
            fileId: fileId,
            url: file.getUrl(),
            downloadUrl: file.getDownloadUrl(),
            createdAt: data[i][resumeCreatedAtColIndex],
            lastUpdated: data[i][resumeLastUpdatedColIndex]
          });
        } catch (e) {
          logOperation("getUserResumes", {
            userId: userId, 
            status: "file access error",
            resumeId: data[i][resumeIdColIndex],
            error: e.toString()
          });
        }
      }
    }
    
    logOperation("getUserResumes", {
      userId: userId, 
      count: resumes.length,
      status: "success"
    });
    
    return {
      success: true,
      resumes: resumes
    };
  } catch (error) {
    logOperation("getUserResumes", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to get resumes: " + error.toString()
    };
  }
}

// Function to convert text to DOCX (actually converting to PDF)
function convertTextToDocx(text, fileName) {
  try {
    const tempDoc = DocumentApp.create('TempDoc-' + fileName);
    const body = tempDoc.getBody();
    
    const paragraphs = text.split("\n\n");
    
    const heading = body.appendParagraph("Cover Letter");
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph("");
    
    paragraphs.forEach(paragraph => {
      if (paragraph.trim()) {
        body.appendParagraph(paragraph.trim());
      }
    });
    
    tempDoc.saveAndClose();
    
    const pdfBlob = DriveApp.getFileById(tempDoc.getId()).getAs('application/pdf');
    
    const pdfFileName = fileName.replace(/\.docx$/i, '.pdf');
    pdfBlob.setName(pdfFileName);
    
    DriveApp.getFileById(tempDoc.getId()).setTrashed(true);
    
    return pdfBlob;
  } catch (error) {
    logOperation("convertTextToDocx", {
      fileName: fileName, 
      status: "failed", 
      error: error.toString()
    });
    
    throw new Error("Failed to convert text to PDF: " + error.toString());
  }
}

// Save cover letter
function saveCoverLetter(userId, sessionToken, content, fileName, jobTitle, company) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    if (!content || !fileName) {
      return {
        success: false,
        error: "Content and file name are required"
      };
    }
    
    const userFolder = getOrCreateUserFolder(userId);
    const coverLettersFolders = userFolder.getFoldersByName("coverLetters");
    
    if (!coverLettersFolders.hasNext()) {
      userFolder.createFolder("coverLetters");
      logOperation("saveCoverLetter", {
        userId: userId, 
        status: "created missing coverLetters folder"
      });
    }
    
    const coverLettersFolder = coverLettersFolders.hasNext() ? 
                             coverLettersFolders.next() : 
                             userFolder.createFolder("coverLetters");
    
    // Standardize file name
    fileName = fileName.replace(/\.docx$/i, '.pdf');
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      fileName = fileName.replace(/\.[^/.]+$/, "") + ".pdf";
    }
    
    // Convert text to PDF
    const pdfBlob = convertTextToDocx(content, fileName);
    
    // Save file to Drive
    const file = coverLettersFolder.createFile(pdfBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // Save record to database
    const db = getDatabase();
    const coverLetterSheet = db.getSheetByName(CONFIG.COVER_LETTER_SHEET_NAME);
    const headerRow = coverLetterSheet.getRange(1, 1, 1, coverLetterSheet.getLastColumn()).getValues()[0];
    
    // Get column indices
    const coverIdColIndex = headerRow.indexOf("id");
    const coverUserIdColIndex = headerRow.indexOf("userId");
    const coverNameColIndex = headerRow.indexOf("name");
    const coverFileIdColIndex = headerRow.indexOf("fileId");
    const coverJobTitleColIndex = headerRow.indexOf("jobTitle");
    const coverCompanyColIndex = headerRow.indexOf("company");
    const coverCreatedAtColIndex = headerRow.indexOf("createdAt");
    
    const coverLetterId = Utilities.getUuid();
    const now = new Date().toISOString();
    
    // Create new row with properly positioned data
    const newRow = Array(headerRow.length).fill("");
    newRow[coverIdColIndex] = coverLetterId;
    newRow[coverUserIdColIndex] = userId;
    newRow[coverNameColIndex] = fileName;
    newRow[coverFileIdColIndex] = file.getId();
    newRow[coverJobTitleColIndex] = jobTitle || "";
    newRow[coverCompanyColIndex] = company || "";
    newRow[coverCreatedAtColIndex] = now;
    
    coverLetterSheet.appendRow(newRow);
    
    logOperation("saveCoverLetter", {
      userId: userId, 
      coverLetterId: coverLetterId,
      jobTitle: jobTitle,
      company: company,
      status: "success"
    });
    
    return {
      success: true,
      coverLetterId: coverLetterId,
      fileName: fileName,
      fileId: file.getId(),
      url: file.getUrl(),
      downloadUrl: file.getDownloadUrl()
    };
  } catch (error) {
    logOperation("saveCoverLetter", {
      userId: userId, 
      jobTitle: jobTitle,
      company: company,
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to save cover letter: " + error.toString()
    };
  }
}

// Get user token usage information
function getUserTokenUsage(userId, sessionToken) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    const db = getDatabase();
    const tokenSheet = db.getSheetByName(CONFIG.TOKEN_USAGE_SHEET_NAME);
    
    const data = tokenSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const tokenIdColIndex = headerRow.indexOf("id");
    const tokenUserIdColIndex = headerRow.indexOf("userId");
    const tokenTimestampColIndex = headerRow.indexOf("timestamp");
    const tokenApplicationIdColIndex = headerRow.indexOf("applicationId");
    const tokenCountColIndex = headerRow.indexOf("tokenCount");
    const tokenDescriptionColIndex = headerRow.indexOf("description");
    
    const tokenUsageEntries = [];
    let totalTokens = 0;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][tokenUserIdColIndex] === userId) {
        // Get token count, ensuring it's a number
        const tokenCount = data[i][tokenCountColIndex] ? 
                          Number(data[i][tokenCountColIndex]) : 0;
        
        const entry = {
          id: data[i][tokenIdColIndex],
          timestamp: data[i][tokenTimestampColIndex],
          applicationId: data[i][tokenApplicationIdColIndex] || null,
          tokenCount: tokenCount,
          description: data[i][tokenDescriptionColIndex] || ""
        };
        
        tokenUsageEntries.push(entry);
        totalTokens += tokenCount;
      }
    }
    
    // Sort entries by timestamp (newest first)
    tokenUsageEntries.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    logOperation("getUserTokenUsage", {
      userId: userId, 
      entryCount: tokenUsageEntries.length,
      totalTokens: totalTokens,
      status: "success"
    });
    
    return {
      success: true,
      totalTokens: totalTokens,
      entries: tokenUsageEntries
    };
  } catch (error) {
    logOperation("getUserTokenUsage", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to get token usage: " + error.toString()
    };
  }
}

// Get user support queries
function getUserSupportQueries(userId, sessionToken) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    const db = getDatabase();
    const supportSheet = db.getSheetByName(CONFIG.SUPPORT_QUERY_SHEET_NAME);
    
    if (!supportSheet) {
      return {
        success: true,
        queries: []
      };
    }
    
    const data = supportSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const idColIndex = headerRow.indexOf("id");
    const userIdColIndex = headerRow.indexOf("userId");
    const subjectColIndex = headerRow.indexOf("subject");
    const messageColIndex = headerRow.indexOf("message");
    const timestampColIndex = headerRow.indexOf("timestamp");
    const statusColIndex = headerRow.indexOf("status");
    const browserInfoColIndex = headerRow.indexOf("browserInfo");
    const sourceColIndex = headerRow.indexOf("source");
    const developerMessageColIndex = headerRow.indexOf("developerMessage");
    
    const queries = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdColIndex] === userId) {
        queries.push({
          id: data[i][idColIndex],
          subject: data[i][subjectColIndex],
          message: data[i][messageColIndex],
          timestamp: data[i][timestampColIndex],
          status: data[i][statusColIndex] || "Pending",
          developerMessage: developerMessageColIndex !== -1 ? data[i][developerMessageColIndex] : ""
        });
      }
    }
    
    // Sort by timestamp (most recent first)
    queries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    logOperation("getUserSupportQueries", {
      userId: userId,
      queryCount: queries.length,
      status: "success"
    });
    
    return {
      success: true,
      queries: queries
    };
  } catch (error) {
    logOperation("getUserSupportQueries", {
      userId: userId,
      status: "failed",
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to get support queries: " + error.toString()
    };
  }
}

// Update user tier
function updateUserTier(userId, sessionToken, newTier) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    if (!newTier) {
      return {
        success: false,
        error: "New tier is required"
      };
    }
    
    const db = getDatabase();
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    const data = userSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const userIdColIndex = headerRow.indexOf("userId");
    const userTierColIndex = headerRow.indexOf("userTier");
    
    // Find user row
    let userRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdColIndex] === userId) {
        userRow = i + 1;
        break;
      }
    }
    
    if (userRow === -1) {
      logOperation("updateUserTier", {
        userId: userId, 
        status: "user not found"
      });
      
      return {
        success: false,
        error: "User not found"
      };
    }
    
    if (!["FREE", "PAID", "BETA"].includes(newTier)) {
      logOperation("updateUserTier", {
        userId: userId, 
        status: "invalid tier",
        requestedTier: newTier
      });
      
      return {
        success: false,
        error: "Invalid tier. Must be one of: FREE, PAID, BETA"
      };
    }
    
    if (userTierColIndex >= 0) {
      userSheet.getRange(userRow, userTierColIndex + 1).setValue(newTier);
    } else {
      logOperation("updateUserTier", {
        userId: userId, 
        status: "userTier column not found"
      });
      
      return {
        success: false,
        error: "User tier column not found"
      };
    }
    
    logOperation("updateUserTier", {
      userId: userId, 
      newTier: newTier,
      status: "success"
    });
    
    return {
      success: true,
      userId: userId,
      userTier: newTier
    };
  } catch (error) {
    logOperation("updateUserTier", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to update user tier: " + error.toString()
    };
  }
}

// Utility function to fix misaligned user data
function fixUserData() {
  try {
    const db = getDatabase();
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    
    const data = userSheet.getDataRange().getValues();
    const headerRow = data[0];
    
    // Get column indices
    const userIdColIndex = headerRow.indexOf("userId");
    const userTierColIndex = headerRow.indexOf("userTier");
    const sessionTokenColIndex = headerRow.indexOf("sessionToken");
    
    let fixedCount = 0;
    
    // Check and fix each row
    for (let i = 1; i < data.length; i++) {
      const rowNum = i + 1;
      let needsFixing = false;
      
      // Check if userTier contains a UUID (which should be in sessionToken)
      const currentTier = data[i][userTierColIndex];
      const userId = data[i][userIdColIndex];
      
      if (currentTier && currentTier.includes("-") && currentTier.length > 20) {
        // This looks like a UUID that should be in sessionToken
        const sessionValue = data[i][sessionTokenColIndex];
        
        // Swap values if needed
        userSheet.getRange(rowNum, userTierColIndex + 1).setValue("BETA");
        if (!sessionValue || sessionValue.includes("T")) {
          // If session token is empty or contains a timestamp, put the UUID there
          userSheet.getRange(rowNum, sessionTokenColIndex + 1).setValue(currentTier);
        }
        
        needsFixing = true;
        logOperation("fixUserData", {
          userId: userId, 
          status: "fixed misplaced UUID in userTier"
        });
      }
      // If userTier is empty or invalid, set a default
      else if (!currentTier || !["FREE", "PAID", "BETA"].includes(currentTier)) {
        userSheet.getRange(rowNum, userTierColIndex + 1).setValue("BETA");
        needsFixing = true;
        
        logOperation("fixUserData", {
          userId: userId, 
          status: "set default tier",
          oldTier: currentTier,
          newTier: "BETA"
        });
      }
      
      if (needsFixing) {
        fixedCount++;
      }
    }
    
    return `Fixed ${fixedCount} user records`;
  } catch (error) {
    logOperation("fixUserData", {status: "failed", error: error.toString()});
    return "Error fixing user data: " + error.toString();
  }
}

// Utility function to generate a service status report
function getSystemStatus() {
  try {
    const db = getDatabase();
    
    // Get user count
    const userSheet = db.getSheetByName(CONFIG.USER_SHEET_NAME);
    const userData = userSheet.getDataRange().getValues();
    const userCount = userData.length - 1; // Subtract header row
    
    // Get tier distribution
    const userTierColIndex = userData[0].indexOf("userTier");
    const tierDistribution = {
      "FREE": 0,
      "PAID": 0,
      "BETA": 0,
      "UNKNOWN": 0
    };
    
    for (let i = 1; i < userData.length; i++) {
      const tier = userData[i][userTierColIndex];
      if (tier && ["FREE", "PAID", "BETA"].includes(tier)) {
        tierDistribution[tier]++;
      } else {
        tierDistribution["UNKNOWN"]++;
      }
    }
    
    // Get application count
    const appSheet = db.getSheetByName(CONFIG.APPLICATION_SHEET_NAME);
    const appCount = appSheet.getLastRow() - 1; // Subtract header row
    
    // Get global tokens remaining
    const globalSheet = getGlobalTokensSheet();
    const lastRow = globalSheet.getLastRow();
    let tokensRemaining = 0;
    if (lastRow >= 2) {
      tokensRemaining = parseInt(globalSheet.getRange(lastRow, 2).getValue()) || 0;
    }
    
    // Get recent activity - last 10 token usages
    const tokenSheet = db.getSheetByName(CONFIG.TOKEN_USAGE_SHEET_NAME);
    const tokenData = tokenSheet.getDataRange().getValues();
    const recentActivity = [];
    
    if (tokenData.length > 1) {
      // Find indices
      const timestampIndex = tokenData[0].indexOf("timestamp");
      const userIdIndex = tokenData[0].indexOf("userId");
      const tokenCountIndex = tokenData[0].indexOf("tokenCount");
      const descriptionIndex = tokenData[0].indexOf("description");
      
      // Sort by timestamp (newest first)
      const sortedData = tokenData.slice(1).sort((a, b) => {
        return new Date(b[timestampIndex]) - new Date(a[timestampIndex]);
      });
      
      // Get last 10 entries
      const recentEntries = sortedData.slice(0, 10);
      
      for (const entry of recentEntries) {
        recentActivity.push({
          timestamp: entry[timestampIndex],
          userId: entry[userIdIndex],
          tokens: entry[tokenCountIndex],
          description: entry[descriptionIndex]
        });
      }
    }
    
    // Calculate BETA user daily limits
    const betaLimits = calculateBetaDailyLimits();
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
      version: CONFIG.VERSION,
      userCount: userCount,
      tierDistribution: tierDistribution,
      applicationCount: appCount,
      tokensRemaining: tokensRemaining,
      betaUserDailyLimits: betaLimits,
      recentActivity: recentActivity
    };
  } catch (error) {
    logOperation("getSystemStatus", {status: "failed", error: error.toString()});
    return {
      success: false,
      error: "Failed to get system status: " + error.toString()
    };
  }
}

// Resume Upload Handler
// Handles direct file uploads

// Handles GET requests - returns simple status or document
function doGet(e) {
  try {
    if (e.parameter.init === "true") {
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: initializeDatabase()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.fix === "true") {
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: fixUserData()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.status === "true") {
      return ContentService.createTextOutput(JSON.stringify(
        getSystemStatus()
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "validateSession") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      return ContentService.createTextOutput(JSON.stringify(
        validateSession(userId, sessionToken)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "getUserApplications") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      return ContentService.createTextOutput(JSON.stringify(
        getUserApplications(userId, sessionToken)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "getUserResumes") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      return ContentService.createTextOutput(JSON.stringify(
        getUserResumes(userId, sessionToken)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "getUserTokenUsage") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      return ContentService.createTextOutput(JSON.stringify(
        getUserTokenUsage(userId, sessionToken)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "getUserSupportQueries") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      return ContentService.createTextOutput(JSON.stringify(
        getUserSupportQueries(userId, sessionToken)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.action === "getUserInfo") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      const validation = validateSession(userId, sessionToken);
      if (validation.success) {
        // Calculate daily applications info
        const applicationsData = getUserApplications(userId, sessionToken);
        
        // Ensure userTier is one of the expected values
        let userTier = validation.userTier;
        if (!["FREE", "PAID", "BETA"].includes(userTier)) {
          userTier = "BETA"; // Default to BETA for testing dynamic limits
        }
        
        // Always include dynamicDailyLimit for BETA users
        let dynamicLimits = undefined;
        if (userTier === "BETA") {
          dynamicLimits = calculateBetaDailyLimits();
        }
        
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          userId: validation.userId,
          email: validation.email,
          name: validation.name,
          userTier: userTier,
          tokenUsage: validation.tokenUsage,
          userContext: validation.userContext || null,
          dynamicDailyLimit: dynamicLimits,
          dailyApplications: applicationsData.success ? applicationsData.dailyApplications : []
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify(validation))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    if (e.parameter.action === "getUserContext") {
      const userId = e.parameter.userId;
      const sessionToken = e.parameter.sessionToken;
      
      const validation = validateSession(userId, sessionToken);
      if (!validation.success) {
        return ContentService.createTextOutput(JSON.stringify(validation))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      const contextData = getUserContextData(userId);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        contextData: contextData
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (e.parameter.fileId) {
      try {
        const fileId = e.parameter.fileId;
        const file = DriveApp.getFileById(fileId);
        const fileBlob = file.getBlob();
        
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          fileId: fileId,
          fileName: file.getName(),
          url: file.getUrl(),
          downloadUrl: file.getDownloadUrl(),
          mimeType: fileBlob.getContentType()
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        logOperation("doGet.fileId", {
          fileId: e.parameter.fileId, 
          status: "failed", 
          error: error.toString()
        });
        
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "File not found or access denied",
          message: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Default response
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Job Application Automator API is running",
      version: CONFIG.VERSION,
      authEnabled: true
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    logOperation("doGet", {
      query: e ? JSON.stringify(e.parameter) : "null", 
      status: "failed", 
      error: error.toString()
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Request processing failed",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Handles POST requests - receives and saves files, handles API actions
function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "No data received"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    // Handle different API actions
    if (action === "register") {
      return ContentService.createTextOutput(JSON.stringify(
        registerUser(payload.email, payload.password, payload.name)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "login") {
      return ContentService.createTextOutput(JSON.stringify(
        loginUser(payload.email, payload.password)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "trackApplication") {
      return ContentService.createTextOutput(JSON.stringify(
        trackApplication(payload.userId, payload.sessionToken, payload.application)
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "updateApplicationStatus") {
      return ContentService.createTextOutput(JSON.stringify(
        updateApplicationStatus(
          payload.userId,
          payload.sessionToken,
          payload.applicationId,
          payload.status
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "uploadResume") {
      return ContentService.createTextOutput(JSON.stringify(
        uploadResume(
          payload.userId,
          payload.sessionToken,
          payload.fileData,
          payload.fileName,
          payload.contentType
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "saveCoverLetter") {
      return ContentService.createTextOutput(JSON.stringify(
        saveCoverLetter(
          payload.userId,
          payload.sessionToken,
          payload.content,
          payload.fileName,
          payload.jobTitle,
          payload.company
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "trackTokenUsage") {
      return ContentService.createTextOutput(JSON.stringify(
        trackTokenUsage(
          payload.userId,
          payload.tokenCount,
          payload.applicationId,
          payload.description
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "updateUserTier") {
      return ContentService.createTextOutput(JSON.stringify(
        updateUserTier(
          payload.userId,
          payload.sessionToken,
          payload.tier
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "updateUserContext") {
      return ContentService.createTextOutput(JSON.stringify(
        updateUserContext(
          payload.userId,
          payload.sessionToken,
          payload.contextData
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "submitSupportQuery") {
      return ContentService.createTextOutput(JSON.stringify(
        submitSupportQuery(
          payload.userId,
          payload.sessionToken,
          payload.subject,
          payload.message,
          payload.userData,
          payload.source,
          payload.browserInfo
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "getUserSupportQueries") {
      return ContentService.createTextOutput(JSON.stringify(
        getUserSupportQueries(
          payload.userId,
          payload.sessionToken
        )
      )).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Handle direct file upload (legacy support)
    if (!action && payload.fileData) {
      try {
        let folder;
        const folderIterator = DriveApp.getFoldersByName(CONFIG.RESUME_FOLDER_NAME);
        
        if (folderIterator.hasNext()) {
          folder = folderIterator.next();
        } else {
          folder = DriveApp.createFolder(CONFIG.RESUME_FOLDER_NAME);
        }
        
        const fileData = payload.fileData;
        const fileName = payload.fileName || "resume.pdf";
        const contentType = payload.contentType || "application/pdf";
        
        // Handle base64 data
        let decoded;
        if (fileData.indexOf(',') !== -1) {
          decoded = Utilities.base64Decode(fileData.split(',')[1]);
        } else {
          decoded = Utilities.base64Decode(fileData);
        }
        
        const blob = Utilities.newBlob(decoded, contentType, fileName);
        
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          fileId: file.getId(),
          fileName: file.getName(),
          url: file.getUrl(),
          downloadUrl: file.getDownloadUrl()
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        logOperation("doPost.fileUpload", {
          fileName: payload.fileName, 
          status: "failed", 
          error: error.toString()
        });
        
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "File upload failed",
          message: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Unified LLM entrypoint: choose provider based on payload.provider or server-side default
    if (action === "callLLM") {
      const provider = (payload.provider || '').toLowerCase();
      const userId = payload.userId;
      const sessionToken = payload.sessionToken;
      const requestData = payload.requestData || {};
      
      // Normalize: ensure messages exist if provided differently
      if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "Invalid request: messages array is required"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      let result;
      if (provider === 'cerebras') {
        // Cerebras accepts chat-completions format
        result = callCerebrasAI(userId, sessionToken, requestData);
      } else {
        // Decide between OpenAI Responses API (gpt-5 family) and Chat Completions
        const isResponsesModel = (requestData.model || '').includes('gpt-5') || Array.isArray(requestData.input);
        if (isResponsesModel) {
          // Normalize for Responses API
          const normalized = Object.assign({}, requestData);
          // Responses uses max_output_tokens; remove max_tokens/max_completion_tokens if present
          if (normalized.max_tokens != null && normalized.max_output_tokens == null) {
            normalized.max_output_tokens = normalized.max_tokens;
          }
          delete normalized.max_tokens;
          delete normalized.max_completion_tokens;
          // Remove Chat Completions-only fields that cause 400s on Responses API
          if (normalized.messages !== undefined) delete normalized.messages;
          // Remove sampling params not supported by certain Responses models
          if (normalized.temperature !== undefined) delete normalized.temperature;
          if (normalized.top_p !== undefined) delete normalized.top_p;
          result = callOpenAIResponses(userId, sessionToken, normalized);
        } else {
          // Chat Completions path
          const normalized = Object.assign({}, requestData);
          // Newer chat models may require max_completion_tokens
          if (normalized.max_output_tokens != null && normalized.max_completion_tokens == null) {
            normalized.max_completion_tokens = normalized.max_output_tokens;
            delete normalized.max_output_tokens;
          }
          if (normalized.max_tokens != null && normalized.max_completion_tokens == null) {
            normalized.max_completion_tokens = normalized.max_tokens;
            delete normalized.max_tokens;
          }
          // Remove Responses-only fields that cause 400s on chat completions
          if (normalized.input !== undefined) delete normalized.input;
          if (normalized.text !== undefined) delete normalized.text;
          if (normalized.reasoning !== undefined) delete normalized.reasoning;
          if (normalized.store !== undefined) delete normalized.store;
          result = callOpenAI(userId, sessionToken, normalized);
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Add new case in your if-else chain
    else if (action === "saveUserCoverLetterSettings") {
      const userId = payload.userId;
      const sessionToken = payload.sessionToken;
      const settings = payload.settings;
      
      return ContentService
        .createTextOutput(JSON.stringify(saveUserCoverLetterSettings(userId, sessionToken, settings)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === "getUserCoverLetterSettings") {
      const userId = payload.userId;
      const sessionToken = payload.sessionToken;
      
      return ContentService
        .createTextOutput(JSON.stringify(getUserCoverLetterSettings(userId, sessionToken)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Unknown action or invalid request format"
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    logOperation("doPost", {
      action: e.postData ? "Request had data" : "No post data", 
      status: "failed", 
      error: error.toString()
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Request processing failed",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// OpenAI Responses API caller (for gpt-5 family)
function callOpenAIResponses(userId, sessionToken, requestData) {
  try {
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return { success: false, error: "Authentication required to access this service" };
    }
    const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
    if (!apiKey) {
      logOperation("callOpenAIResponses", { userId: userId, status: "API key not found in properties" });
      return { success: false, error: "API key not configured on the server" };
    }

    logOperation("callOpenAIResponses", { userId: userId, status: "making API request", model: requestData.model });

    const openAIResponsesUrl = "https://api.openai.com/v1/responses";
    // Ensure no Chat Completions-only or unsupported fields are sent
    const payload = (function sanitizeForResponses(input) {
      const clone = Object.assign({}, input);
      if (clone.messages !== undefined) delete clone.messages;
      if (clone.temperature !== undefined) delete clone.temperature;
      if (clone.top_p !== undefined) delete clone.top_p;
      return clone;
    })(requestData);
    const response = UrlFetchApp.fetch(openAIResponsesUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    if (responseCode !== 200) {
      logOperation("callOpenAIResponses", { userId: userId, status: "API error", responseCode: responseCode });
      return { success: false, error: `OpenAI API Error (${responseCode}): ${responseText}` };
    }
    const responseData = JSON.parse(responseText);
    const tokenUsage = responseData.usage?.total_tokens || 0;
    if (tokenUsage > 0) {
      trackTokenUsage(userId, tokenUsage, null, "OpenAI Responses API call");
    }
    logOperation("callOpenAIResponses", { userId: userId, status: "success", tokenUsage: tokenUsage });
    return { success: true, data: responseData };
  } catch (error) {
    logOperation("callOpenAIResponses", { userId: userId, status: "failed", error: error.toString() });
    return { success: false, error: "Failed to call OpenAI Responses API: " + error.toString() };
  }
}

// Server-side function to make OpenAI API calls
function callOpenAI(userId, sessionToken, requestData) {
  try {
    // First validate the user's session
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return {
        success: false,
        error: "Authentication required to access this service"
      };
    }
    
    // Retrieve the API key from script properties (already set up by admin)
    const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
    
    if (!apiKey) {
      logOperation("callOpenAI", {
        userId: userId, 
        status: "API key not found in properties"
      });
      
      return {
        success: false,
        error: "API key not configured on the server"
      };
    }
    
    // Log the API call (without logging sensitive data)
    logOperation("callOpenAI", {
      userId: userId, 
      status: "making API request",
      model: requestData.model
    });
    
    // Make the API call to OpenAI using the chat completions endpoint
    const openAIApiUrl = "https://api.openai.com/v1/chat/completions";
    
   // Make the API call
const response = UrlFetchApp.fetch(openAIApiUrl, {
  method: 'post',
  contentType: 'application/json',
  headers: {
    'Authorization': 'Bearer ' + apiKey
  },
  payload: JSON.stringify(requestData),
  muteHttpExceptions: true
});
    
    // Parse the response
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      logOperation("callOpenAI", {
        userId: userId, 
        status: "API error",
        responseCode: responseCode
      });
      
      return {
        success: false,
        error: `OpenAI API Error (${responseCode}): ${responseText}`
      };
    }
    
    // Track token usage for billing/limits
    const responseData = JSON.parse(responseText);
    const tokenUsage = responseData.usage?.total_tokens || 0;
    
    if (tokenUsage > 0) {
      trackTokenUsage(userId, tokenUsage, null, "OpenAI API call");
    }
    
    // Log successful completion
    logOperation("callOpenAI", {
      userId: userId, 
      status: "success",
      tokenUsage: tokenUsage
    });
    
    return {
      success: true,
      data: responseData
    };
  } catch (error) {
    logOperation("callOpenAI", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to call OpenAI API: " + error.toString()
    };
  }
}

// Update the global tokens pool by subtracting tokens consumed
function updateGlobalTokens(tokensUsed, userId, description) {
  // ... existing code ...
}

// Submit a support query to the SupportQuery sheet
function submitSupportQuery(userId, sessionToken, subject, message, userData, source, browserInfo) {
  try {
    // Validate the session (make sure user is authorized)
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return sessionValidation;
    }
    
    if (!subject || !message) {
      return {
        success: false,
        error: "Subject and message are required"
      };
    }
    
    const db = getDatabase();
    let supportSheet = db.getSheetByName(CONFIG.SUPPORT_QUERY_SHEET_NAME);
    
    // Create the sheet if it doesn't exist
    if (!supportSheet) {
      supportSheet = createOrUpdateSheet(db, CONFIG.SUPPORT_QUERY_SHEET_NAME, [
        "id", "userId", "email", "name", "userTier", "subject", "message", 
        "timestamp", "status", "browserInfo", "source", "developerMessage"
      ]);
    }
    
    // Get the sheet header row
    const headerRow = supportSheet.getRange(1, 1, 1, supportSheet.getLastColumn()).getValues()[0];
    
    // In submitSupportQuery, after defining the headers, add 'developerMessage' if not present:
    if (headerRow.indexOf('developerMessage') === -1) {
      supportSheet.getRange(1, headerRow.length + 1).setValue('developerMessage');
    }
    const developerMessageColIndex = supportSheet.getRange(1, 1, 1, supportSheet.getLastColumn()).getValues()[0].indexOf('developerMessage');
    
    // Get column indices for each field
    const idColIndex = headerRow.indexOf("id");
    const userIdColIndex = headerRow.indexOf("userId");
    const emailColIndex = headerRow.indexOf("email");
    const nameColIndex = headerRow.indexOf("name");
    const userTierColIndex = headerRow.indexOf("userTier");
    const subjectColIndex = headerRow.indexOf("subject");
    const messageColIndex = headerRow.indexOf("message");
    const timestampColIndex = headerRow.indexOf("timestamp");
    const statusColIndex = headerRow.indexOf("status");
    const browserInfoColIndex = headerRow.indexOf("browserInfo");
    const sourceColIndex = headerRow.indexOf("source");
    
    // Generate a unique ID for the query
    const queryId = Utilities.getUuid();
    
    // Get user info
    const email = userData?.email || "Unknown";
    const name = userData?.name || "Unknown";
    const userTier = userData?.userTier || "FREE";
    const timestamp = new Date().toISOString();
    
    // Create new row with correctly positioned values
    const newRow = Array(headerRow.length).fill("");
    newRow[idColIndex] = queryId;
    newRow[userIdColIndex] = userId;
    newRow[emailColIndex] = email;
    newRow[nameColIndex] = name;
    newRow[userTierColIndex] = userTier;
    newRow[subjectColIndex] = subject;
    newRow[messageColIndex] = message;
    newRow[timestampColIndex] = timestamp;
    newRow[statusColIndex] = "New";
    newRow[browserInfoColIndex] = browserInfo || "";
    newRow[sourceColIndex] = source || "Extension";
    
    // When creating newRow, ensure it has developerMessage as last column:
    if (developerMessageColIndex !== -1) {
      newRow[developerMessageColIndex] = "";
    }
    
    // Append the row
    supportSheet.appendRow(newRow);
    
    logOperation("submitSupportQuery", {
      userId: userId, 
      email: email,
      subject: subject,
      status: "success"
    });
    
    return {
      success: true,
      queryId: queryId,
      message: "Your support request has been submitted successfully."
    };
  } catch (error) {
    logOperation("submitSupportQuery", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to submit support query: " + error.toString()
    };
  }
}

// Generate a JSON web token

// Add these functions before the doPost function

/**
 * Save user cover letter settings to Google Sheets
 */
function saveUserCoverLetterSettings(userId, sessionToken, settings) {
  try {
    // Validate the session first
    const userData = validateSession(userId, sessionToken);
    if (!userData) {
      return { success: false, error: "Invalid session. Please log in again." };
    }

    // Get or create UserSettings sheet
    let settingsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.USER_SETTINGS_SHEET_NAME);
    if (!settingsSheet) {
      settingsSheet = SpreadsheetApp.getActive().insertSheet(CONFIG.USER_SETTINGS_SHEET_NAME);
      // Create header row
      settingsSheet.appendRow([
        "userId",
        "settingsType",
        "settings",
        "lastUpdated"
      ]);
    }

    // Format settings as JSON string
    const settingsJson = JSON.stringify(settings);
    const now = new Date().toISOString();

    // Check if user already has cover letter settings
    const userRows = settingsSheet.getDataRange().getValues();
    let rowIndex = -1;
    
    for (let i = 1; i < userRows.length; i++) {
      if (userRows[i][0] === userId && userRows[i][1] === 'coverLetter') {
        rowIndex = i + 1; // +1 because sheet rows are 1-indexed
        break;
      }
    }

    if (rowIndex > 0) {
      // Update existing row
      settingsSheet.getRange(rowIndex, 3).setValue(settingsJson);
      settingsSheet.getRange(rowIndex, 4).setValue(now);
    } else {
      // Add new row
      settingsSheet.appendRow([userId, 'coverLetter', settingsJson, now]);
    }

    // Log the operation
    logOperation("saveUserCoverLetterSettings", {
      userId: userId,
      status: "success"
    });

    return {
      success: true,
      message: "Cover letter settings saved successfully"
    };
  } catch (error) {
    logOperation("saveUserCoverLetterSettings", {
      userId: userId,
      error: error.toString(),
      status: "error"
    });
    
    return {
      success: false,
      error: "Error saving cover letter settings: " + error.toString()
    };
  }
}

/**
 * Get user cover letter settings from Google Sheets
 */
function getUserCoverLetterSettings(userId, sessionToken) {
  try {
    // Validate the session first
    const userData = validateSession(userId, sessionToken);
    if (!userData) {
      return { success: false, error: "Invalid session. Please log in again." };
    }

    // Get UserSettings sheet
    const settingsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.USER_SETTINGS_SHEET_NAME);
    if (!settingsSheet) {
      return { 
        success: true, 
        settings: null,
        message: "No settings found" 
      };
    }

    // Find user's cover letter settings
    const userRows = settingsSheet.getDataRange().getValues();
    let settings = null;
    
    for (let i = 1; i < userRows.length; i++) {
      if (userRows[i][0] === userId && userRows[i][1] === 'coverLetter') {
        try {
          settings = JSON.parse(userRows[i][2]);
        } catch (e) {
          // If JSON parsing fails, return null
          settings = null;
        }
        break;
      }
    }

    return {
      success: true,
      settings: settings
    };
  } catch (error) {
    logOperation("getUserCoverLetterSettings", {
      userId: userId,
      error: error.toString(),
      status: "error"
    });
    
    return {
      success: false,
      error: "Error retrieving cover letter settings: " + error.toString()
    };
  }
}

// Server-side function to make Cerebras AI API calls (replaces OpenAI)
function callCerebrasAI(userId, sessionToken, requestData) {
  try {
    // First validate the user's session
    const sessionValidation = validateSession(userId, sessionToken);
    if (!sessionValidation.success) {
      return {
        success: false,
        error: "Authentication required to access this service"
      };
    }
    
    // Retrieve the Cerebras API key from script properties
    const apiKey = PropertiesService.getScriptProperties().getProperty("CEREBRAS_API_KEY");
    
    if (!apiKey) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "API key not found in properties"
      });
      
      return {
        success: false,
        error: "Cerebras API key not configured on the server. Please contact administrator."
      };
    }
    
    // Validate API key format
    if (!apiKey.startsWith('csk-')) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "Invalid API key format"
      });
      
      return {
        success: false,
        error: "Invalid Cerebras API key format. Key should start with 'csk-'"
      };
    }
    
    // Prepare request data for Cerebras API format
    const cerebrasRequestData = {
      model: requestData.model || "qwen-3-32b",
      stream: false,
      max_tokens: Math.min(requestData.max_tokens || 4000, 16382), // Cap at Cerebras limit
      temperature: Math.max(0.1, Math.min(requestData.temperature || 0.7, 2.0)), // Valid range
      top_p: Math.max(0.1, Math.min(requestData.top_p || 0.95, 1.0)), // Valid range
      messages: requestData.messages || []
    };
    
    // Validate messages array
    if (!Array.isArray(cerebrasRequestData.messages) || cerebrasRequestData.messages.length === 0) {
      return {
        success: false,
        error: "Invalid messages format. Must be a non-empty array."
      };
    }
    
    // Log the API call (without logging sensitive data)
    logOperation("callCerebrasAI", {
      userId: userId, 
      status: "making API request",
      model: cerebrasRequestData.model,
      messageCount: cerebrasRequestData.messages.length,
      maxTokens: cerebrasRequestData.max_tokens
    });
    
    // Make the API call to Cerebras AI using the chat completions endpoint
    const cerebrasApiUrl = "https://api.cerebras.ai/v1/chat/completions";
    
    // Make the API call with improved error handling
    let response;
    try {
      response = UrlFetchApp.fetch(cerebrasApiUrl, {
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        payload: JSON.stringify(cerebrasRequestData),
        muteHttpExceptions: true
      });
    } catch (fetchError) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "fetch error",
        error: fetchError.toString()
      });
      
      return {
        success: false,
        error: "Network error calling Cerebras API: " + fetchError.toString()
      };
    }
    
    // Parse the response
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    const contentType = response.getHeaders()['Content-Type'] || '';
    
    // Log response details for debugging
    logOperation("callCerebrasAI", {
      userId: userId, 
      status: "received response",
      responseCode: responseCode,
      contentType: contentType,
      responseLength: responseText.length
    });
    
    // Check if response is HTML (error page)
    if (contentType.includes('text/html') || responseText.trim().startsWith('<')) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "HTML response received",
        responseCode: responseCode,
        responseSnippet: responseText.substring(0, 200)
      });
      
      return {
        success: false,
        error: `Cerebras API returned HTML instead of JSON (Code: ${responseCode}). Service may be down or API key invalid.`
      };
    }
    
    // Check for non-200 status codes
    if (responseCode !== 200) {
      let errorMessage = `Cerebras AI API Error (${responseCode})`;
      
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error && errorData.error.message) {
          errorMessage += `: ${errorData.error.message}`;
        } else {
          errorMessage += `: ${responseText}`;
        }
      } catch (e) {
        errorMessage += `: ${responseText}`;
      }
      
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "API error",
        responseCode: responseCode,
        error: errorMessage
      });
      
      return {
        success: false,
        error: errorMessage
      };
    }
    
    // Try to parse the JSON response
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "JSON parse error",
        parseError: parseError.toString(),
        responseSnippet: responseText.substring(0, 500)
      });
      
      return {
        success: false,
        error: "Invalid JSON response from Cerebras API: " + parseError.toString()
      };
    }
    
    // Validate the response structure
    if (!responseData.choices || !Array.isArray(responseData.choices) || responseData.choices.length === 0) {
      logOperation("callCerebrasAI", {
        userId: userId, 
        status: "Invalid response structure",
        responseKeys: Object.keys(responseData || {})
      });
      
      return {
        success: false,
        error: "Invalid response structure from Cerebras API"
      };
    }
    
    // Track token usage for billing/limits
    const tokenUsage = responseData.usage?.total_tokens || 0;
    
    if (tokenUsage > 0) {
      trackTokenUsage(userId, tokenUsage, null, "Cerebras AI API call");
    }
    
    // Log successful completion
    logOperation("callCerebrasAI", {
      userId: userId, 
      status: "success",
      tokenUsage: tokenUsage,
      responseChoices: responseData.choices.length
    });
    
    return {
      success: true,
      data: responseData
    };
  } catch (error) {
    logOperation("callCerebrasAI", {
      userId: userId, 
      status: "failed", 
      error: error.toString()
    });
    
    return {
      success: false,
      error: "Failed to call Cerebras AI API: " + error.toString()
    };
  }
}

// (Removed duplicate callOpenAI overrides to preserve OpenAI path used by callLLM)

// Test function for Cerebras AI integration (admin use only)
function testCerebrasAI() {
  console.log("=== Testing Cerebras AI Integration ===");
  
  try {
    // Check if API key exists
    const apiKey = PropertiesService.getScriptProperties().getProperty("CEREBRAS_API_KEY");
    
    if (!apiKey) {
      console.log("❌ ERROR: CEREBRAS_API_KEY not found in script properties");
      console.log("📝 Please add the API key:");
      console.log("   1. Go to Project Settings (gear icon)");
      console.log("   2. Click 'Script Properties'");
      console.log("   3. Add property: CEREBRAS_API_KEY");
      console.log("   4. Value: csk-694krty582p3n5k6ykdk9vfjpprvcvk83d99eehdrevmt3mh");
      return {
        success: false,
        error: "CEREBRAS_API_KEY not configured"
      };
    }
    
    // Validate API key format
    if (!apiKey.startsWith('csk-')) {
      console.log("❌ ERROR: Invalid API key format. Should start with 'csk-'");
      console.log("Current key starts with:", apiKey.substring(0, 10) + "...");
      return {
        success: false,
        error: "Invalid API key format"
      };
    }
    
    console.log("✅ API key found and format looks correct");
    console.log("🔑 Key preview:", apiKey.substring(0, 10) + "..." + apiKey.substring(apiKey.length - 4));
    
    // Prepare test request
    const cerebrasRequestData = {
      model: "qwen-3-32b",
      stream: false,
      max_tokens: 50,
      temperature: 0.7,
      top_p: 0.95,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. Respond with a simple JSON object containing a 'message' field."
        },
        {
          role: "user",
          content: "Say hello and confirm you are working. Respond in JSON format: {\"message\": \"your response\"}"
        }
      ]
    };
    
    console.log("📤 Making API request to Cerebras...");
    console.log("Request data:", JSON.stringify(cerebrasRequestData, null, 2));
    
    // Make the API call
    const response = UrlFetchApp.fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify(cerebrasRequestData),
      muteHttpExceptions: true
    });
    
    // Analyze response
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    const contentType = response.getHeaders()['Content-Type'] || 'unknown';
    
    console.log("📨 Response received:");
    console.log("   Status Code:", responseCode);
    console.log("   Content-Type:", contentType);
    console.log("   Response Length:", responseText.length);
    console.log("   First 200 chars:", responseText.substring(0, 200));
    
    // Check for HTML response (common error)
    if (contentType.includes('text/html') || responseText.trim().startsWith('<')) {
      console.log("❌ ERROR: Received HTML instead of JSON");
      console.log("This usually means:");
      console.log("   - API key is invalid");
      console.log("   - API endpoint is wrong");
      console.log("   - Service is down");
      console.log("Full response:", responseText);
      
      return {
        success: false,
        error: "API returned HTML instead of JSON",
        details: {
          responseCode: responseCode,
          contentType: contentType,
          responsePreview: responseText.substring(0, 500)
        }
      };
    }
    
    // Check status code
    if (responseCode !== 200) {
      console.log("❌ ERROR: Non-200 status code:", responseCode);
      
      try {
        const errorData = JSON.parse(responseText);
        console.log("Error details:", JSON.stringify(errorData, null, 2));
        
        return {
          success: false,
          error: `API Error (${responseCode})`,
          details: errorData
        };
      } catch (e) {
        console.log("Could not parse error as JSON:", responseText);
        return {
          success: false,
          error: `API Error (${responseCode}): ${responseText}`
        };
      }
    }
    
    // Try to parse JSON
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      console.log("❌ ERROR: Could not parse response as JSON");
      console.log("Parse error:", parseError.toString());
      console.log("Raw response:", responseText);
      
      return {
        success: false,
        error: "Invalid JSON response",
        details: {
          parseError: parseError.toString(),
          rawResponse: responseText
        }
      };
    }
    
    // Validate response structure
    if (!responseData.choices || !Array.isArray(responseData.choices) || responseData.choices.length === 0) {
      console.log("❌ ERROR: Invalid response structure");
      console.log("Response keys:", Object.keys(responseData));
      console.log("Full response:", JSON.stringify(responseData, null, 2));
      
      return {
        success: false,
        error: "Invalid response structure",
        details: responseData
      };
    }
    
    // Success!
    console.log("✅ SUCCESS: Cerebras AI is working correctly!");
    console.log("Response data:", JSON.stringify(responseData, null, 2));
    
    if (responseData.choices[0] && responseData.choices[0].message) {
      console.log("🤖 AI Response:", responseData.choices[0].message.content);
    }
    
    if (responseData.usage) {
      console.log("📊 Token usage:", responseData.usage);
    }
    
    return {
      success: true,
      data: responseData,
      message: "Cerebras AI integration test passed successfully!",
      details: {
        model: responseData.model || "unknown",
        tokensUsed: responseData.usage?.total_tokens || 0,
        responseTime: "N/A"
      }
    };
    
  } catch (error) {
    console.log("❌ EXCEPTION during test:", error.toString());
    console.log("Stack trace:", error.stack);
    
    return {
      success: false,
      error: "Test failed with exception: " + error.toString(),
      details: {
        exception: error.toString(),
        stack: error.stack
      }
    };
  }
}