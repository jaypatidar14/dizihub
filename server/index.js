import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store WhatsApp clients and their data
const whatsappSessions = new Map();
const sessionData = new Map();
const groupsCache = new Map();
const browserInstances = new Map();
const sessionStates = new Map();
const messageQueue = new Map();

// Ensure sessions directory exists
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Enhanced session state management
function setSessionState(sessionId, state) {
  sessionStates.set(sessionId, {
    ...sessionStates.get(sessionId),
    ...state,
    lastUpdate: Date.now()
  });
}

function getSessionState(sessionId) {
  return sessionStates.get(sessionId) || { 
    isInitializing: false, 
    isConnected: false, 
    isDestroying: false,
    lastUpdate: Date.now()
  };
}

// Debug function to check client state
function debugClientState(sessionId, client) {
  try {
    console.log(`=== DEBUG SESSION ${sessionId} ===`);
    console.log('Client exists:', !!client);
    console.log('Client info exists:', !!client?.info);
    console.log('Client state:', client?.state);
    console.log('Client isReady:', !!client?.info?.wid);
    console.log('Browser connected:', client?.pupBrowser?.isConnected?.() || 'unknown');
    console.log('Page exists:', !!client?.pupPage);
    console.log('================================');
  } catch (error) {
    console.log(`Debug error for ${sessionId}:`, error.message);
  }
}

// Improved session validation
function isSessionValid(sessionId, client) {
  try {
    if (!client) {
      console.log(`Session ${sessionId}: No client`);
      return false;
    }
    
    const state = getSessionState(sessionId);
    if (state.isDestroying) {
      console.log(`Session ${sessionId}: Is destroying`);
      return false;
    }
    
    // More thorough validation
    if (!client.info || !client.info.wid) {
      console.log(`Session ${sessionId}: Client not ready (no info or wid)`);
      return false;
    }

    // Check browser connection
    if (client.pupBrowser && !client.pupBrowser.isConnected()) {
      console.log(`Session ${sessionId}: Browser disconnected`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn(`Session validation error for ${sessionId}:`, error.message);
    return false;
  }
}

// Alternative group fetching method using WhatsApp Web directly
async function fetchGroupsAlternative(sessionId, client, socket) {
  console.log(`🔄 Attempting alternative group fetch for session ${sessionId}`);
  
  try {
    // Method 1: Try using getChatById for each known group
    socket.emit('groups-loading', { sessionId, status: 'loading_alternative' });

    // First, let's try to get the page and execute some WhatsApp Web JavaScript directly
    if (!client.pupPage) {
      throw new Error('Puppeteer page not available');
    }

    console.log(`Executing WhatsApp Web script for ${sessionId}`);
    
    // Execute JavaScript directly in WhatsApp Web to get groups
    const groupsData = await client.pupPage.evaluate(() => {
      try {
        // Try to access WhatsApp's internal Store
        if (window.Store && window.Store.Chat) {
          const chats = window.Store.Chat.getModelsArray();
          return chats
            .filter(chat => chat.isGroup)
            .map(group => ({
              id: group.id._serialized || group.id,
              name: group.formattedTitle || group.contact?.formattedName || 'Unnamed Group',
              participantCount: group.groupMetadata?.participants?.length || 0,
              lastActivity: group.t || Date.now(),
              unreadCount: group.unreadCount || 0
            }));
        }
        
        // Fallback: try alternative Store access
        if (window.webpackChunkwhatsapp_web_client) {
          const modules = window.webpackChunkwhatsapp_web_client;
          // This is a more complex approach but might work
          return [];
        }
        
        return null;
      } catch (e) {
        console.error('Error in page evaluation:', e);
        return null;
      }
    });

    if (groupsData && Array.isArray(groupsData)) {
      console.log(`✅ Alternative method found ${groupsData.length} groups for session ${sessionId}`);
      
      const groups = groupsData.map(group => ({
        id: group.id,
        name: group.name,
        participantCount: group.participantCount,
        isSelected: false,
        tags: [],
        lastActivity: group.lastActivity,
        unreadCount: group.unreadCount
      }));

      // Update session data
      const session = sessionData.get(sessionId);
      if (session) {
        session.groups = groups;
        session.groupsLoaded = true;
        session.lastActivity = new Date();
        sessionData.set(sessionId, session);

        socket.emit('groups-data', { sessionId, groups });
        io.emit('session-update', {
          sessionId,
          status: session.status,
          phoneNumber: session.phoneNumber,
          groups: groups
        });

        return true;
      }
    } else {
      console.log(`⚠️ Alternative method failed for session ${sessionId}, trying standard getChats()`);
      return await fetchGroupsStandard(sessionId, client, socket);
    }

  } catch (error) {
    console.error(`Alternative group fetch failed for ${sessionId}:`, error.message);
    return await fetchGroupsStandard(sessionId, client, socket);
  }
}

// Standard group fetching method (your original approach, improved)
async function fetchGroupsStandard(sessionId, client, socket) {
  console.log(`📱 Standard group fetch for session ${sessionId}`);
  
  try {
    if (!isSessionValid(sessionId, client)) {
      throw new Error('Session is not valid');
    }

    // Add a longer wait for WhatsApp Web to stabilize
    console.log(`Waiting for WhatsApp Web to stabilize...`);
    await new Promise(resolve => setTimeout(resolve, 10000));

    if (!client || typeof client.getChats !== 'function') {
      throw new Error('getChats method not available');
    }

    console.log(`Calling getChats() for session ${sessionId}`);
    
    // Much longer timeout and better error handling
    const chatsPromise = client.getChats();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('getChats() timeout after 120 seconds')), 120000)
    );

    const chats = await Promise.race([chatsPromise, timeoutPromise]);

    if (!Array.isArray(chats)) {
      throw new Error(`getChats() returned ${typeof chats} instead of array`);
    }

    console.log(`getChats() returned ${chats.length} total chats for session ${sessionId}`);

    const groups = chats
      .filter(chat => {
        try {
          return chat && chat.isGroup === true;
        } catch (err) {
          return false;
        }
      })
      .map(group => {
        try {
          return {
            id: group.id?._serialized || group.id || '',
            name: group.name || group.formattedTitle || 'Unnamed Group',
            participantCount: group.participants?.length || group.groupMetadata?.participants?.length || 0,
            isSelected: false,
            tags: [],
            lastActivity: group.timestamp || group.t || Date.now(),
            unreadCount: group.unreadCount || 0
          };
        } catch (err) {
          console.warn(`Error processing group:`, err);
          return null;
        }
      })
      .filter(group => group !== null && group.id);

    console.log(`✅ Processed ${groups.length} groups for session ${sessionId}`);

    // Update session data
    const session = sessionData.get(sessionId);
    if (session) {
      session.groups = groups;
      session.groupsLoaded = true;
      session.lastActivity = new Date();
      sessionData.set(sessionId, session);

      socket.emit('groups-data', { sessionId, groups });
      io.emit('session-update', {
        sessionId,
        status: session.status,
        phoneNumber: session.phoneNumber,
        groups: groups
      });

      return true;
    }

    return false;

  } catch (error) {
    console.error(`Standard group fetch failed for ${sessionId}:`, error.message);
    throw error;
  }
}

// Main group fetching function with multiple strategies
async function fetchGroupsWithMultipleStrategies(sessionId, client, socket, maxAttempts = 3) {
  console.log(`🚀 Starting multi-strategy group fetch for session ${sessionId}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Attempt ${attempt}/${maxAttempts} for session ${sessionId}`);
    try {
      // Debug the client state
      debugClientState(sessionId, client);

      if (!isSessionValid(sessionId, client)) {
        console.log(`Session ${sessionId} is not valid on attempt ${attempt}`);
        if (attempt === maxAttempts) {
          socket.emit('groups-error', {
            sessionId,
            error: 'Session is not connected or ready'
          });
          return false;
        }
        // small backoff before next attempt
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }

      // Strategy 1: Try alternative method first (faster)
      try {
        const altSuccess = await fetchGroupsAlternative(sessionId, client, socket);
        if (altSuccess) return true;
      } catch (error) {
        console.log(`Alternative method failed: ${error.message}`);
      }

      // Strategy 2: Try standard method
      try {
        const stdSuccess = await fetchGroupsStandard(sessionId, client, socket);
        if (stdSuccess) return true;
      } catch (error) {
        console.log(`Standard method failed: ${error.message}`);
      }

      // Strategy 3: Manual approach (last resort on final attempt)
      if (attempt === maxAttempts) {
        console.log(`🔧 Trying manual approach for session ${sessionId}`);
        try {
          if (client && client.pupPage) {
            await client.pupPage.evaluate(() => {
              if (window.Store && window.Store.Chat) {
                // trigger any available lazy loading
                window.Store.Chat.getModelsArray();
              }
            });
            // allow some time after manual trigger
            await new Promise(resolve => setTimeout(resolve, 5000));
            const finalSuccess = await fetchGroupsStandard(sessionId, client, socket);
            if (finalSuccess) return true;
          }
        } catch (error) {
          console.log(`Manual approach failed: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed completely:`, error.message);
    }

    if (attempt < maxAttempts) {
      const delay = 10000 * attempt; // increasing delay between attempts
      console.log(`⏳ Waiting ${delay}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error(`❌ All strategies failed for session ${sessionId}`);
  socket.emit('groups-error', {
    sessionId,
    error: 'Unable to load groups after multiple attempts. Try reconnecting the session.',
    canRetry: true
  });

  return false;
}

// REST API endpoints
app.get('/api/sessions', (req, res) => {
  const sessions = Array.from(sessionData.values()).map(session => ({
    id: session.id,
    status: session.status,
    phoneNumber: session.phoneNumber,
    groupCount: session.groups.length,
    selectedGroups: session.groups.filter(g => g.isSelected).length,
    lastActivity: session.lastActivity,
    messagesSent: session.messagesSent || 0,
    groupsLoaded: session.groupsLoaded || false
  }));
  
  res.json(sessions);
});

app.get('/api/sessions/:sessionId/groups', (req, res) => {
  const { sessionId } = req.params;
  
  if (sessionData.has(sessionId)) {
    const session = sessionData.get(sessionId);
    res.json({
      groups: session.groups,
      count: session.groups.length,
      selected: session.groups.filter(g => g.isSelected).length,
      loaded: session.groupsLoaded
    });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Debug endpoint to check session state
app.get('/api/sessions/:sessionId/debug', (req, res) => {
  const { sessionId } = req.params;
  
  const session = sessionData.get(sessionId);
  const state = getSessionState(sessionId);
  const hasClient = whatsappSessions.has(sessionId);
  const hasBrowser = browserInstances.has(sessionId);
  const client = whatsappSessions.get(sessionId);
  
  res.json({
    sessionId,
    sessionExists: !!session,
    sessionData: session || null,
    sessionState: state,
    hasClient,
    hasBrowser,
    clientReady: client?.info?.wid ? true : false,
    browserConnected: client?.pupBrowser?.isConnected?.() || false,
    timestamp: new Date().toISOString()
  });
});

// Force group refresh endpoint with multiple strategies
app.post('/api/sessions/:sessionId/refresh-groups', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    if (!whatsappSessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const client = whatsappSessions.get(sessionId);
    if (!isSessionValid(sessionId, client)) {
      return res.status(400).json({ error: 'Session is not connected' });
    }

    // Clear cache and reset groups
    groupsCache.delete(sessionId);
    const session = sessionData.get(sessionId);
    if (session) {
      session.groups = [];
      session.groupsLoaded = false;
      sessionData.set(sessionId, session);
    }

    console.log(`🔄 API refresh started for session ${sessionId}`);

    // Start background refresh with all strategies
    fetchGroupsWithMultipleStrategies(sessionId, client, { 
      emit: (event, data) => {
        io.emit(event, data); // Broadcast to all connected clients
      }
    }, 5).then(success => {
      console.log(`✅ API refresh for ${sessionId} ${success ? 'succeeded' : 'failed'}`);
    });

    res.json({ 
      success: true, 
      message: 'Group refresh started with multiple strategies',
      sessionId 
    });

  } catch (error) {
    console.error('Error in force refresh API:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to check if WhatsApp client is responsive
app.get('/api/sessions/:sessionId/test', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    if (!whatsappSessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const client = whatsappSessions.get(sessionId);
    
    if (!isSessionValid(sessionId, client)) {
      return res.status(400).json({ error: 'Session is not connected' });
    }

    // Test basic client functionality
    const testResults = {
      clientExists: !!client,
      hasInfo: !!client.info,
      hasWid: !!client.info?.wid,
      browserConnected: client.pupBrowser?.isConnected?.() || false,
      pageExists: !!client.pupPage
    };

    // Try a simple operation
    try {
      const info = client.info;
      testResults.phoneNumber = info?.wid?.user || 'unknown';
      testResults.clientTest = 'success';
    } catch (error) {
      testResults.clientTest = 'failed';
      testResults.clientError = error.message;
    }

    res.json({
      sessionId,
      timestamp: new Date().toISOString(),
      tests: testResults
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      sessionId,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/health', (req, res) => {
  const connectedSessions = Array.from(sessionData.values()).filter(session => 
    session.status === 'connected'
  );
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    sessions: {
      total: sessionData.size,
      connected: connectedSessions.length,
      with_groups: connectedSessions.filter(s => s.groupsLoaded).length
    }
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  
  const cleanupPromises = Array.from(sessionData.keys()).map(sessionId => 
    cleanupSession(sessionId, 'shutdown')
  );
  
  try {
    await Promise.allSettled(cleanupPromises); // Use allSettled instead of all
    console.log('✅ All sessions cleaned up');
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  
  const cleanupPromises = Array.from(sessionData.keys()).map(sessionId => 
    cleanupSession(sessionId, 'shutdown')
  );
  
  try {
    await Promise.allSettled(cleanupPromises);
    console.log('✅ All sessions cleaned up');
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
  }
  
  process.exit(0);
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  // Don't exit immediately, try to continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit immediately, try to continue
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔧 Multi-strategy group fetching enabled`);
  console.log(`🐛 Enhanced debugging and error handling active`);
  console.log(`📱 WhatsApp Web.js with Chrome compatibility mode`);
});


// Clean up session with better error handling
async function cleanupSession(sessionId, reason = 'manual') {
  console.log(`🧹 Cleaning up session ${sessionId} (reason: ${reason})`);
  
  const state = getSessionState(sessionId);
  if (state.isDestroying) {
    console.log(`Session ${sessionId} is already being destroyed, skipping...`);
    return;
  }
  
  setSessionState(sessionId, { isDestroying: true, isConnected: false });
  
  try {
    // Clear message queue
    messageQueue.delete(sessionId);
    groupsCache.delete(sessionId);

    // Destroy WhatsApp client
    if (whatsappSessions.has(sessionId)) {
      const client = whatsappSessions.get(sessionId);
      try {
        if (client && typeof client.destroy === 'function') {
          await Promise.race([
            client.destroy(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), 15000))
          ]);
        }
      } catch (error) {
        console.warn(`Error destroying client ${sessionId}:`, error.message);
      }
      whatsappSessions.delete(sessionId);
    }

    // Clear browser instance
    if (browserInstances.has(sessionId)) {
      const browser = browserInstances.get(sessionId);
      try {
        if (browser && browser.isConnected()) {
          await browser.close();
        }
      } catch (error) {
        console.warn(`Error closing browser ${sessionId}:`, error.message);
      }
      browserInstances.delete(sessionId);
    }

    // Update session data
    if (sessionData.has(sessionId)) {
      const session = sessionData.get(sessionId);
      session.status = 'disconnected';
      session.groups = [];
      session.groupsLoaded = false;
      sessionData.set(sessionId, session);
    }
    
    sessionStates.delete(sessionId);
    
    console.log(`✅ Session ${sessionId} cleaned up successfully`);
  } catch (error) {
    console.error(`❌ Error during cleanup of session ${sessionId}:`, error);
  } finally {
    setSessionState(sessionId, { isDestroying: false });
  }
}

// Initialize WhatsApp session with minimal configuration (more reliable)
async function initializeWhatsAppSession(sessionId, socket) {
  const state = getSessionState(sessionId);
  if (state.isInitializing) {
    console.log(`Session ${sessionId} is already initializing`);
    return;
  }
  
  setSessionState(sessionId, { isInitializing: true });
  
  try {
    console.log(`🔥 Initializing WhatsApp session: ${sessionId}`);
    
    // Simplified, more reliable configuration
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: sessionId,
        dataPath: './sessions'
      }),
      puppeteer: {
        headless: true,
        args: ['--disable-gpu', '--disable-dev-shm-usage'],
        timeout: 0
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      }
    });

    whatsappSessions.set(sessionId, client);

    // Initialize session data
    sessionData.set(sessionId, {
      id: sessionId,
      status: 'initializing',
      qrCode: null,
      phoneNumber: null,
      groups: [],
      lastActivity: new Date(),
      groupsLoaded: false,
      messagesSent: 0,
      messagesQueue: 0
    });

    messageQueue.set(sessionId, []);

    // QR Code handling
    client.on('qr', async (qr) => {
      console.log(`📱 QR Code generated for session ${sessionId}`);
      
      try {
        const qrCodeDataUrl = await QRCode.toDataURL(qr);
        
        const data = sessionData.get(sessionId);
        if (data) {
          data.qrCode = qrCodeDataUrl;
          data.status = 'waiting_for_scan';
          sessionData.set(sessionId, data);

          socket.emit('qr-code', {
            sessionId,
            qrCode: qrCodeDataUrl,
            status: 'waiting_for_scan'
          });

          io.emit('session-update', {
            sessionId,
            status: 'waiting_for_scan',
            qrCode: qrCodeDataUrl
          });
        }
      } catch (error) {
        console.error(`Error generating QR code for session ${sessionId}:`, error);
      }
    });

    client.on('authenticated', () => {
      console.log(`✅ Authentication successful for session ${sessionId}`);
      const data = sessionData.get(sessionId);
      if (data) {
        data.status = 'authenticated';
        data.qrCode = null;
        sessionData.set(sessionId, data);

        socket.emit('authenticated', { sessionId, status: 'authenticated' });
        io.emit('session-update', { sessionId, status: 'authenticated' });
      }

      // Fallback: try to fetch groups after 30 seconds if not ready
      setTimeout(() => {
        const fallbackClient = whatsappSessions.get(sessionId);
        const fallbackSession = sessionData.get(sessionId);
        if (fallbackSession && fallbackSession.status !== 'connected') {
          console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
          fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
        }
      }, 30000);
    });

    client.on('ready', async () => {
      console.log(`🚀 WhatsApp client ready for session ${sessionId}`);
      
      try {
        // Store browser and page references
        if (client.pupBrowser) {
          browserInstances.set(sessionId, client.pupBrowser);
        }
        
        const clientInfo = client.info;
        if (!clientInfo || !clientInfo.wid) {
          throw new Error('Client info not available after ready event');
        }

        setSessionState(sessionId, { isConnected: true, isInitializing: false });
        
        const data = sessionData.get(sessionId);
        if (data) {
          data.status = 'connected';
          data.phoneNumber = clientInfo.wid.user;
          data.qrCode = null;
          sessionData.set(sessionId, data);

          socket.emit('client-ready', {
            sessionId,
            phoneNumber: clientInfo.wid.user,
            status: 'connected',
            groups: []
          });

          io.emit('session-update', {
            sessionId,
            status: 'connected',
            phoneNumber: clientInfo.wid.user,
            groups: []
          });

          console.log(`📋 Scheduling group fetch for session ${sessionId}`);

          // Wait longer for WhatsApp Web to fully load
          setTimeout(async () => {
            if (isSessionValid(sessionId, client)) {
              console.log(`🔍 Starting group fetch for session ${sessionId}`);
              const success = await fetchGroupsWithMultipleStrategies(sessionId, client, socket);
              
              if (!success) {
                console.log(`⚠️ Group fetch failed, but session is still connected`);
                socket.emit('groups-fetch-failed', {
                  sessionId,
                  message: 'Groups could not be loaded. You can try the refresh button or reconnect the session.'
                });
              }
            } else {
              console.warn(`Session ${sessionId} is no longer valid after ready`);
            }
          }, 20000); // Wait 20 seconds
        }
      } catch (error) {
        console.error(`Error in ready event for session ${sessionId}:`, error);
        
        socket.emit('client-ready-error', {
          sessionId,
          error: error.message
        });
      }
    });

    // Enhanced error handling
    client.on('auth_failure', async (msg) => {
      console.log(`❌ Authentication failure for session ${sessionId}:`, msg);
      
      socket.emit('auth-failure', { sessionId, message: msg });
      await cleanupSession(sessionId, 'auth_failure');
      
      io.emit('session-update', {
        sessionId,
        status: 'disconnected',
        error: 'Authentication failed'
      });
    });

    client.on('disconnected', async (reason) => {
      console.log(`🔌 Client disconnected for session ${sessionId}:`, reason);
      
      const data = sessionData.get(sessionId);
      if (data) {
        data.status = 'disconnected';
        sessionData.set(sessionId, data);
      }

      setSessionState(sessionId, { isConnected: false });

      socket.emit('disconnected', { sessionId, reason });
      io.emit('session-update', { sessionId, status: 'disconnected', reason });
    });

    // Add more specific error handling
    client.on('error', async (error) => {
      console.error(`💥 Client error for session ${sessionId}:`, error.message);
      
      if (error.message.includes('Target closed') || 
          error.message.includes('Protocol error') ||
          error.message.includes('Connection refused')) {
        console.log(`🔄 Browser connection lost for ${sessionId}, cleaning up...`);
        await cleanupSession(sessionId, 'connection_lost');
        
        socket.emit('session-error', {
          sessionId,
          error: 'Connection lost',
          shouldReconnect: true
        });
      }
    });

    console.log(`🎯 Starting client initialization for session ${sessionId}`);
    await client.initialize();

  } catch (error) {
    console.error(`💥 Error initializing session ${sessionId}:`, error);
    
    setSessionState(sessionId, { isInitializing: false, isConnected: false });
    
    socket.emit('initialization-error', {
      sessionId,
      error: error.message
    });

    io.emit('session-update', {
      sessionId,
      status: 'disconnected',
      error: error.message
    });
  }
}

// Message sending with better error handling
async function sendMessage(sessionId, groupId, message, media = null) {
  try {
    if (!whatsappSessions.has(sessionId)) {
      throw new Error('Session not found');
    }

    const client = whatsappSessions.get(sessionId);
    
    if (!isSessionValid(sessionId, client)) {
      throw new Error('Session is not connected');
    }

    let result;
    
    if (media) {
      const mediaMessage = MessageMedia.fromFilePath(media.path);
      result = await client.sendMessage(groupId, mediaMessage, { caption: message });
    } else {
      result = await client.sendMessage(groupId, message);
    }

    // Update stats
    const session = sessionData.get(sessionId);
    if (session) {
      session.messagesSent = (session.messagesSent || 0) + 1;
      session.lastActivity = new Date();
      sessionData.set(sessionId, session);
    }

    return result;
  } catch (error) {
    console.error(`Error sending message in session ${sessionId}:`, error);
    throw error;
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Send current sessions
  const activeSessions = Array.from(sessionData.values());
  socket.emit('sessions-data', activeSessions);
  
  // Send groups for each session
  activeSessions.forEach(session => {
    if (session.groups && session.groups.length > 0) {
      socket.emit('groups-data', {
        sessionId: session.id,
        groups: session.groups
      });
    }
  });

  // Create new session
  socket.on('create-session', async (data) => {
    const { sessionId } = data;
    
    if (whatsappSessions.has(sessionId)) {
      socket.emit('session-exists', { sessionId });
      return;
    }

    await initializeWhatsAppSession(sessionId, socket);
  });

  // Get groups for session
  socket.on('get-groups', async (data) => {
    const { sessionId } = data;
    
    if (sessionData.has(sessionId)) {
      const session = sessionData.get(sessionId);
      socket.emit('groups-data', {
        sessionId,
        groups: session.groups || []
      });
    } else {
      socket.emit('groups-data', { sessionId, groups: [] });
    }
  });

  // Toggle group selection
  socket.on('toggle-group', (data) => {
    const { sessionId, groupId } = data;
    console.log(`🔄 Toggle group request: session=${sessionId}, group=${groupId}`);
    
    if (sessionData.has(sessionId)) {
      const session = sessionData.get(sessionId);
      const group = session.groups.find(g => g.id === groupId);
      
      if (group) {
        group.isSelected = !group.isSelected;
        sessionData.set(sessionId, session);
        
        console.log(`📋 Group ${group.name} ${group.isSelected ? 'selected' : 'deselected'}`);
        
        socket.emit('group-toggled', {
          sessionId,
          groupId,
          isSelected: group.isSelected,
          groupName: group.name
        });

        io.emit('group-update', {
          sessionId,
          groupId,
          isSelected: group.isSelected
        });
        
        io.emit('session-update', {
          sessionId,
          status: session.status,
          phoneNumber: session.phoneNumber,
          groups: session.groups
        });
      } else {
        socket.emit('group-toggle-error', {
          sessionId,
          groupId,
          error: 'Group not found'
        });
      }
    } else {
      socket.emit('group-toggle-error', {
        sessionId,
        groupId,
        error: 'Session not found'
      });
    }
  });

  // Refresh groups
  socket.on('refresh-groups', async (data) => {
    const { sessionId } = data;
    console.log(`🔄 Manual group refresh requested for session ${sessionId}`);
    
    if (whatsappSessions.has(sessionId)) {
      const client = whatsappSessions.get(sessionId);
      if (isSessionValid(sessionId, client)) {
        // Clear any cached data first
        groupsCache.delete(sessionId);
        
        const success = await fetchGroupsWithMultipleStrategies(sessionId, client, socket, 2);
        if (!success) {
          socket.emit('refresh-failed', {
            sessionId,
            error: 'Manual refresh failed. Consider reconnecting the session.'
          });
        }
      } else {
        socket.emit('groups-error', {
          sessionId,
          error: 'Session is not connected'
        });
      }
    } else {
      socket.emit('groups-error', {
        sessionId,
        error: 'Session not found'
      });
    }
  });

  // Disconnect session
  socket.on('disconnect-session', async (data) => {
    const { sessionId } = data;
    
    try {
      await cleanupSession(sessionId, 'manual_disconnect');
      socket.emit('session-disconnected', { sessionId });
      
      io.emit('session-update', {
        sessionId,
        status: 'disconnected',
        removed: true
      });
    } catch (error) {
      console.error(`Error disconnecting session:`, error);
      socket.emit('disconnect-error', { sessionId, error: error.message });
    }
  });

  // Send message
  socket.on('send-message', async (data) => {
    const { sessionId, groupId, message, media } = data;
    
    try {
      const result = await sendMessage(sessionId, groupId, message, media);
      socket.emit('message-sent', {
        sessionId,
        groupId,
        success: true,
        messageId: result.id._serialized
      });
    } catch (error) {
      socket.emit('message-sent', {
        sessionId,
        groupId,
        success: false,
        error: error.message
      });
    }
  });

  // Send bulk messages
  socket.on('send-bulk-messages', async (data) => {
    const { sessionId, groupIds, message, media, delay = 3000 } = data;
    
    try {
      if (!Array.isArray(groupIds) || groupIds.length === 0) {
        throw new Error('No groups selected');
      }

      socket.emit('bulk-message-started', {
        sessionId,
        totalGroups: groupIds.length
      });

      const results = [];
      
      for (let i = 0; i < groupIds.length; i++) {
        const groupId = groupIds[i];
        
        try {
          const result = await sendMessage(sessionId, groupId, message, media);
          results.push({ groupId, success: true, result });
          
          socket.emit('bulk-message-progress', {
            sessionId,
            progress: {
              sent: i + 1,
              total: groupIds.length,
              current: groupId,
              success: true
            }
          });

          if (i < groupIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }

        } catch (error) {
          results.push({ groupId, success: false, error: error.message });
          
          socket.emit('bulk-message-progress', {
            sessionId,
            progress: {
              sent: i + 1,
              total: groupIds.length,
              current: groupId,
              success: false,
              error: error.message
            }
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;

      socket.emit('bulk-message-completed', {
        sessionId,
        results: results,
        summary: {
          total: groupIds.length,
          success: successCount,
          failed: failedCount
        }
      });

      io.emit('bulk-message-completed', {
        sessionId,
        summary: {
          total: groupIds.length,
          success: successCount,
          failed: failedCount
        }
      });

    } catch (error) {
        socket.emit('bulk-message-error', {
          sessionId: data && data.sessionId ? data.sessionId : null,
          error: error.message
        });
      }
    });
  
  });  client.on('authenticated', () => {
    console.log(`✅ Authentication successful for session ${sessionId}`);
    const data = sessionData.get(sessionId);
    if (data) {
      data.status = 'authenticated';
      data.qrCode = null;
      sessionData.set(sessionId, data);
      socket.emit('authenticated', { sessionId, status: 'authenticated' });
      io.emit('session-update', { sessionId, status: 'authenticated' });
    }
  
    // Fallback: try to fetch groups after 30 seconds if not ready
    setTimeout(() => {
      const fallbackClient = whatsappSessions.get(sessionId);
      const fallbackSession = sessionData.get(sessionId);
      if (fallbackSession && fallbackSession.status !== 'connected') {
        console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
        fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
      }
    }, 30000);
  });  client.on('authenticated', () => {
    console.log(`✅ Authentication successful for session ${sessionId}`);
    const data = sessionData.get(sessionId);
    if (data) {
      data.status = 'authenticated';
      data.qrCode = null;
      sessionData.set(sessionId, data);
      socket.emit('authenticated', { sessionId, status: 'authenticated' });
      io.emit('session-update', { sessionId, status: 'authenticated' });
    }
  
    // Fallback: try to fetch groups after 30 seconds if not ready
    setTimeout(() => {
      const fallbackClient = whatsappSessions.get(sessionId);
      const fallbackSession = sessionData.get(sessionId);
      if (fallbackSession && fallbackSession.status !== 'connected') {
        console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
        fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
      }
    }, 30000);
  });  client.on('authenticated', () => {
    console.log(`✅ Authentication successful for session ${sessionId}`);
    const data = sessionData.get(sessionId);
    if (data) {
      data.status = 'authenticated';
      data.qrCode = null;
      sessionData.set(sessionId, data);
      socket.emit('authenticated', { sessionId, status: 'authenticated' });
      io.emit('session-update', { sessionId, status: 'authenticated' });
    }
  
    // Fallback: try to fetch groups after 30 seconds if not ready
    setTimeout(() => {
      const fallbackClient = whatsappSessions.get(sessionId);
      const fallbackSession = sessionData.get(sessionId);
      if (fallbackSession && fallbackSession.status !== 'connected') {
        console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
        fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
      }
    }, 30000);
  });  client.on('authenticated', () => {
    console.log(`✅ Authentication successful for session ${sessionId}`);
    const data = sessionData.get(sessionId);
    if (data) {
      data.status = 'authenticated';
      data.qrCode = null;
      sessionData.set(sessionId, data);
      socket.emit('authenticated', { sessionId, status: 'authenticated' });
      io.emit('session-update', { sessionId, status: 'authenticated' });
    }
  
    // Fallback: try to fetch groups after 30 seconds if not ready
    setTimeout(() => {
      const fallbackClient = whatsappSessions.get(sessionId);
      const fallbackSession = sessionData.get(sessionId);
      if (fallbackSession && fallbackSession.status !== 'connected') {
        console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
        fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
      }
    }, 30000);
  });  client.on('authenticated', () => {
    console.log(`✅ Authentication successful for session ${sessionId}`);
    const data = sessionData.get(sessionId);
    if (data) {
      data.status = 'authenticated';
      data.qrCode = null;
      sessionData.set(sessionId, data);
      socket.emit('authenticated', { sessionId, status: 'authenticated' });
      io.emit('session-update', { sessionId, status: 'authenticated' });
    }
  
    // Fallback: try to fetch groups after 30 seconds if not ready
    setTimeout(() => {
      const fallbackClient = whatsappSessions.get(sessionId);
      const fallbackSession = sessionData.get(sessionId);
      if (fallbackSession && fallbackSession.status !== 'connected') {
        console.log(`[FALLBACK] Trying to fetch groups after authentication for session ${sessionId}`);
        fetchGroupsWithMultipleStrategies(sessionId, fallbackClient, socket, 3);
      }
    }, 30000);
  });