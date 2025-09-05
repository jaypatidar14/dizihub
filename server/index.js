import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173", 
      "http://localhost:5174",
      "https://dizihub.onrender.com",
      process.env.CLIENT_URL
    ].filter(Boolean), // Remove undefined values
    methods: ["GET", "POST"],
    credentials: true
  }
});

// FIXED: Enhanced CORS configuration
app.use(cors({
  origin: [
    "http://localhost:5173", 
    "http://localhost:5174",
    "https://dizihub.onrender.com",
    process.env.CLIENT_URL
  ].filter(Boolean),
  credentials: true
}));

app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://boltuser:boltuser@cluster0.c511gzk.mongodb.net/projectbolt';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Enhanced User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  settings: {
    bulkMessageDelay: { type: Number, default: 10000 },
    maxRetries: { type: Number, default: 3 },
    autoReconnect: { type: Boolean, default: true }
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Enhanced Session Schema with better state management
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phoneNumber: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['initializing', 'qr_generated', 'waiting_scan', 'authenticating', 'authenticated', 'connected', 'disconnected', 'error'], 
    default: 'initializing' 
  },
  clientInfo: {
    platform: String,
    version: String,
    battery: Number,
    pushName: String
  },
  groupsData: [{ 
    id: String,
    name: String,
    participantCount: Number,
    lastActivity: Date,
    unreadCount: { type: Number, default: 0 },
    description: String,
    isSelected: { type: Boolean, default: false }
  }],
  messagesSent: { type: Number, default: 0 },
  lastActivity: { type: Date, default: Date.now },
  reconnectCount: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  lastError: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

sessionSchema.index({ userId: 1, lastActivity: -1 });

const Session = mongoose.model('Session', sessionSchema);

// Enhanced Message Log Schema
const messageLogSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  groupId: { type: String, required: true },
  groupName: { type: String },
  message: { type: String, required: true },
  mediaPath: { type: String },
  messageId: { type: String },
  status: { type: String, enum: ['sent', 'failed', 'pending'], required: true },
  error: { type: String },
  retryCount: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now }
});

messageLogSchema.index({ sessionId: 1, sentAt: -1 });

const MessageLog = mongoose.model('MessageLog', messageLogSchema);

// File Upload Schema
const uploadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  path: { type: String, required: true },
  url: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
});

const Upload = mongoose.model('Upload', uploadSchema);

// COMPLETELY REWRITTEN Session Management with Database Persistence
class SessionManager {
  constructor() {
    this.activeSessions = new Map();
    this.userSockets = new Map();
    this.qrTimeouts = new Map();
    this.reconnectTimers = new Map();
  }

  // Main entry point - Load from database or create new
  async loadOrCreateSession(sessionId, socket, userId) {
    try {
      console.log(`📚 Loading or creating session: ${sessionId}`);
      
      // First check if already active
      if (this.activeSessions.has(sessionId)) {
        console.log(`✅ Session ${sessionId} already active`);
        const session = this.activeSessions.get(sessionId);
        
        // If groups available, emit them immediately
        if (session.data.groups && session.data.groups.length > 0) {
          this.emitGroupsToUser(userId, sessionId, session.data.groups, session.data.phoneNumber, true);
        }
        return session;
      }

      // Check database for existing session data
      const savedSession = await Session.findOne({ 
        sessionId, 
        userId,
        status: { $in: ['connected', 'authenticated'] }
      }).sort({ lastActivity: -1 });
      
      if (savedSession && savedSession.groupsData && savedSession.groupsData.length > 0) {
        console.log(`💾 Found saved session with ${savedSession.groupsData.length} groups`);
        
        // Quick reconnect using saved data
        await this.quickReconnectFromDatabase(sessionId, socket, userId, savedSession);
        return;
      }

      console.log(`🆕 Creating fresh session: ${sessionId}`);
      await this.initializeSession(sessionId, socket, userId);
      
    } catch (error) {
      console.error(`❌ Error in loadOrCreateSession:`, error);
      throw error;
    }
  }

  // Quick reconnect using database data
  async quickReconnectFromDatabase(sessionId, socket, userId, savedSession) {
    try {
      console.log(`🚀 Quick reconnect for ${sessionId}`);
      
      // Emit groups immediately from database
      this.emitGroupsToUser(userId, sessionId, savedSession.groupsData, savedSession.phoneNumber, true);
      
      // Initialize WhatsApp client in background
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: './sessions'
        }),
        puppeteer: {
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions'
          ]
        }
      });

      const sessionData = {
        id: sessionId,
        userId: userId,
        status: 'connecting',
        phoneNumber: savedSession.phoneNumber,
        groups: savedSession.groupsData || [],
        messagesSent: savedSession.messagesSent || 0,
        reconnectCount: (savedSession.reconnectCount || 0) + 1,
        errorCount: 0,
        lastActivity: new Date(),
        clientInfo: savedSession.clientInfo,
        fromDatabase: true
      };

      const session = {
        client: client,
        data: sessionData
      };

      this.activeSessions.set(sessionId, session);

      // Setup minimal event handlers for reconnect
      this.setupQuickReconnectHandlers(sessionId, client, socket, userId);

      // Initialize client in background
      client.initialize().catch(error => {
        console.error(`❌ Quick reconnect failed, falling back to fresh init:`, error);
        this.cleanupSession(sessionId, 'quick_reconnect_failed');
        setTimeout(() => this.initializeSession(sessionId, socket, userId), 3000);
      });

      console.log(`✅ Quick reconnect initiated for ${sessionId}`);

    } catch (error) {
      console.error(`❌ Quick reconnect error:`, error);
      // Fallback to normal initialization
      await this.initializeSession(sessionId, socket, userId);
    }
  }

  // Emit groups to user with multiple strategies
  emitGroupsToUser(userId, sessionId, groups, phoneNumber, fromCache = false) {
    const groupsData = {
      sessionId,
      groups,
      phoneNumber,
      fromCache,
      timestamp: new Date()
    };

    console.log(`📡 Emitting ${groups.length} groups to user ${userId} (fromCache: ${fromCache})`);

    // Multiple emission strategies for reliability
    io.to(`user_${userId}`).emit('groups-loaded', groupsData);
    
    const userSocket = this.userSockets.get(userId);
    if (userSocket && userSocket.connected) {
      userSocket.emit('groups-loaded', groupsData);
    }

    // Also emit session ready if from database
    if (fromCache) {
      io.to(`user_${userId}`).emit('session-ready', {
        sessionId,
        status: 'connected',
        phoneNumber,
        quickReconnect: true,
        groupCount: groups.length
      });
    }
  }

  // Quick reconnect event handlers
  setupQuickReconnectHandlers(sessionId, client, socket, userId) {
    
    client.on('ready', async () => {
      console.log(`✅ Quick reconnect ready: ${sessionId}`);
      
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.data.status = 'connected';
        session.data.lastActivity = new Date();
        
        // Update client info if available
        if (client.info && client.info.wid) {
          session.data.clientInfo = {
            platform: client.info.platform || 'unknown',
            pushName: client.info.pushname || session.data.clientInfo?.pushName || 'Unknown',
            battery: client.info.battery || 0
          };
        }
        
        await this.saveSessionToDatabase(sessionId);
        
        // Confirm session is ready
        io.to(`user_${userId}`).emit('session-status-update', {
          sessionId,
          status: 'connected',
          quickReconnect: true,
          timestamp: new Date()
        });
      }
    });

    client.on('disconnected', async (reason) => {
      console.log(`🔌 Quick reconnect session ${sessionId} disconnected: ${reason}`);
      await this.handleDisconnection(sessionId, reason);
    });

    client.on('auth_failure', (msg) => {
      console.log(`❌ Quick reconnect auth failed: ${msg}`);
      this.cleanupSession(sessionId, 'auth_failure');
      // Try fresh initialization
      setTimeout(() => this.initializeSession(sessionId, socket, userId), 5000);
    });

    // Handle state changes
    client.on('change_state', (state) => {
      console.log(`🔄 Quick reconnect state: ${state} for ${sessionId}`);
      if (state === 'CONNECTED') {
        const session = this.getSession(sessionId);
        if (session) {
          session.data.status = 'connected';
        }
      }
    });
  }

  // Full session initialization (for new sessions)
  async initializeSession(sessionId, socket, userId, existingSessionData = null) {
    try {
      console.log(`🚀 Full initialization for session: ${sessionId}`);

      // Cleanup existing session first
      if (this.activeSessions.has(sessionId)) {
        await this.cleanupSession(sessionId, 'reinitialize');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: './sessions'
        }),
        puppeteer: {
          headless: 'new',
          timeout: 0,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        }
      });

      const sessionData = {
        id: sessionId,
        userId: userId,
        status: 'initializing',
        phoneNumber: existingSessionData?.phoneNumber || null,
        groups: existingSessionData?.groupsData || [],
        messagesSent: existingSessionData?.messagesSent || 0,
        reconnectCount: existingSessionData?.reconnectCount || 0,
        errorCount: 0,
        lastActivity: new Date(),
        qrCode: null,
        clientInfo: null
      };

      const session = {
        client: client,
        data: sessionData
      };

      this.activeSessions.set(sessionId, session);

      // Setup full event handlers
      this.setupFullEventHandlers(sessionId, client, socket, userId);

      // Initialize with timeout
      const initTimeout = setTimeout(() => {
        const currentSession = this.getSession(sessionId);
        if (currentSession && currentSession.data.status === 'initializing') {
          console.log(`⏰ Initialization timeout for ${sessionId}`);
          this.setSessionStatus(sessionId, 'error', 'Initialization timeout');
          this.cleanupSession(sessionId, 'timeout');
        }
      }, 300000); // 5 minutes

      try {
        await client.initialize();
        clearTimeout(initTimeout);
        console.log(`✅ Session ${sessionId} initialization started`);
        return session;
      } catch (initError) {
        clearTimeout(initTimeout);
        throw initError;
      }

    } catch (error) {
      console.error(`❌ Error initializing session ${sessionId}:`, error);
      this.setSessionStatus(sessionId, 'error', error.message);
      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  // Full event handlers for new sessions
  setupFullEventHandlers(sessionId, client, socket, userId) {
    
    client.on('qr', (qr) => {
      console.log(`📱 QR Code for ${sessionId}`);
      this.generateQRCode(sessionId, qr, socket, userId).catch(error => {
        console.error(`❌ QR generation failed:`, error);
      });
    });

    client.on('authenticated', async () => {
      console.log(`✅ ${sessionId} authenticated`);
      this.setSessionStatus(sessionId, 'authenticated');
      
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
        this.qrTimeouts.delete(sessionId);
      }
    });

    client.on('ready', async () => {
      console.log(`🚀 ${sessionId} ready`);
      
      try {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        if (client.info && client.info.wid) {
          session.data.status = 'connected';
          session.data.phoneNumber = client.info.wid.user;
          session.data.clientInfo = {
            platform: client.info.platform || 'unknown',
            pushName: client.info.pushname || 'Unknown',
            battery: client.info.battery || 0
          };
          session.data.lastActivity = new Date();

          // Emit ready immediately
          io.to(`user_${userId}`).emit('session-ready', {
            sessionId,
            status: 'connected',
            phoneNumber: session.data.phoneNumber,
            clientInfo: session.data.clientInfo
          });

          // Save basic session info
          await this.saveSessionToDatabase(sessionId);

          // Fetch and save groups
          console.log(`🔍 Starting group fetch for ${sessionId}`);
          setTimeout(async () => {
            try {
              await this.fetchAndSaveGroups(sessionId, client, socket);
            } catch (error) {
              console.error(`❌ Error fetching groups:`, error);
              // Even if groups fail, session is still connected
              io.to(`user_${userId}`).emit('groups-loaded', {
                sessionId,
                groups: [],
                error: 'Could not load groups',
                phoneNumber: session.data.phoneNumber
              });
            }
          }, 15000);
        }

      } catch (error) {
        console.error(`❌ Error in ready event:`, error);
      }
    });

    client.on('disconnected', async (reason) => {
      await this.handleDisconnection(sessionId, reason);
    });

    client.on('auth_failure', (msg) => {
      console.log(`❌ Auth failed for ${sessionId}: ${msg}`);
      this.setSessionStatus(sessionId, 'error', `Authentication failed: ${msg}`);
      
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
        this.qrTimeouts.delete(sessionId);
      }
      
      setTimeout(() => this.cleanupSession(sessionId, 'auth_failure'), 5000);
    });
  }

  // Fetch groups and save to database
  async fetchAndSaveGroups(sessionId, client, socket = null) {
    try {
      console.log(`🔍 Fetching groups for ${sessionId}`);
      
      const session = this.getSession(sessionId);
      if (!session) return [];

      let chats = [];
      let retries = 3;
      
      while (retries > 0) {
        try {
          chats = await Promise.race([
            client.getChats(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 60000)
            )
          ]);
          console.log(`📋 Retrieved ${chats.length} chats`);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.log(`⚠️ Retry ${4-retries}/3 in 5 seconds`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      const groups = chats
        .filter(chat => chat.isGroup && chat.name)
        .map(group => ({
          id: group.id._serialized,
          name: group.name,
          participantCount: group.participants?.length || 0,
          lastActivity: new Date(group.timestamp * 1000),
          unreadCount: group.unreadCount || 0,
          description: group.description || '',
          isSelected: false
        }))
        .sort((a, b) => b.lastActivity - a.lastActivity);

      console.log(`📚 Found ${groups.length} groups`);

      // Update session
      session.data.groups = groups;
      session.data.lastActivity = new Date();

      // Save to database
      await this.saveSessionToDatabase(sessionId);

      // Emit to frontend
      this.emitGroupsToUser(session.data.userId, sessionId, groups, session.data.phoneNumber, false);

      return groups;

    } catch (error) {
      console.error(`❌ Error fetching groups:`, error);
      throw error;
    }
  }

  // Generate QR Code
  async generateQRCode(sessionId, qr, socket, userId) {
    try {
      console.log(`📱 Generating QR for ${sessionId}`);
      
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
      }

      const qrCodeDataUrl = await QRCode.toDataURL(qr, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      const session = this.getSession(sessionId);
      if (session) {
        session.data.qrCode = qrCodeDataUrl;
        this.setSessionStatus(sessionId, 'waiting_scan');

        const qrData = {
          sessionId,
          qrCode: qrCodeDataUrl,
          status: 'waiting_scan',
          timestamp: Date.now()
        };

        io.to(`user_${userId}`).emit('qr-code', qrData);
        if (socket && socket.connected) {
          socket.emit('qr-code', qrData);
        }

        // QR expiry timeout
        this.qrTimeouts.set(sessionId, setTimeout(() => {
          const currentSession = this.getSession(sessionId);
          if (currentSession && currentSession.data.status === 'waiting_scan') {
            console.log(`⏰ QR expired for ${sessionId}`);
            this.setSessionStatus(sessionId, 'error', 'QR code expired');
            io.to(`user_${userId}`).emit('qr-expired', { sessionId });
          }
        }, 300000));
      }

      return qrCodeDataUrl;
    } catch (error) {
      console.error(`❌ QR generation error:`, error);
      throw error;
    }
  }

  // Handle disconnection
  async handleDisconnection(sessionId, reason) {
    console.log(`🔌 Session ${sessionId} disconnected: ${reason}`);
    
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.data.status = 'disconnected';
      session.data.lastError = reason;
      
      // Save to database with groups preserved
      await this.saveSessionToDatabase(sessionId);
      
      io.to(`user_${session.data.userId}`).emit('session-disconnected', {
        sessionId,
        reason,
        groupsPreserved: session.data.groups.length > 0
      });

      this.activeSessions.delete(sessionId);
    }
  }

  // Save session to database with groups
  async saveSessionToDatabase(sessionId) {
    try {
      const session = this.getSession(sessionId);
      if (!session) return;

      const updateData = {
        phoneNumber: session.data.phoneNumber,
        status: session.data.status,
        clientInfo: session.data.clientInfo,
        groupsData: session.data.groups || [], // SAVE GROUPS
        messagesSent: session.data.messagesSent || 0,
        reconnectCount: session.data.reconnectCount || 0,
        errorCount: session.data.errorCount || 0,
        lastError: session.data.lastError,
        lastActivity: session.data.lastActivity,
        updatedAt: new Date()
      };

      await Session.findOneAndUpdate(
        { sessionId, userId: session.data.userId },
        updateData,
        { upsert: true, new: true }
      );

      console.log(`💾 Session saved with ${session.data.groups?.length || 0} groups`);
    } catch (error) {
      console.error(`❌ Save session error:`, error);
    }
  }

  // Set session status
  setSessionStatus(sessionId, status, error = null) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.data.status = status;
      session.data.lastActivity = new Date();
      if (error) {
        session.data.lastError = error;
        session.data.errorCount = (session.data.errorCount || 0) + 1;
      }
      
      io.to(`user_${session.data.userId}`).emit('session-status-update', {
        sessionId,
        status,
        error,
        lastActivity: session.data.lastActivity
      });
    }
  }

  // Get session
  getSession(sessionId) {
    return this.activeSessions.get(sessionId);
  }

  // Get user sessions
  getUserSessions(userId, statusFilter = null) {
    return Array.from(this.activeSessions.values())
      .filter(session => {
        const matchesUser = session.data.userId === userId;
        const matchesStatus = !statusFilter || session.data.status === statusFilter;
        return matchesUser && matchesStatus;
      })
      .map(session => ({
        id: session.data.id,
        status: session.data.status,
        phoneNumber: session.data.phoneNumber,
        groupCount: session.data.groups?.length || 0,
        messagesSent: session.data.messagesSent || 0,
        reconnectCount: session.data.reconnectCount || 0,
        errorCount: session.data.errorCount || 0,
        lastActivity: session.data.lastActivity,
        lastError: session.data.lastError
      }));
  }

  // Enhanced cleanup
  async cleanupSession(sessionId, reason = 'manual') {
    console.log(`🧹 Cleaning up ${sessionId} (${reason})`);
    
    try {
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
        this.qrTimeouts.delete(sessionId);
      }

      const session = this.getSession(sessionId);
      if (session && session.client) {
        try {
          await Promise.race([
            session.client.destroy(),
            new Promise(resolve => setTimeout(resolve, 10000))
          ]);
        } catch (error) {
          console.warn(`Warning during cleanup:`, error.message);
        }
      }

      this.activeSessions.delete(sessionId);
      
      // Update database but preserve groups
      if (reason !== 'shutdown') {
        await Session.findOneAndUpdate(
          { sessionId },
          { status: 'disconnected', lastActivity: new Date() }
        );
      }

    } catch (error) {
      console.error(`❌ Cleanup error:`, error);
      this.activeSessions.delete(sessionId);
    }
  }
}

// FIXED Message Queue with proper callbacks
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.bulkCampaigns = new Map(); // Track bulk campaigns
  }

  async addMessage(sessionId, groupId, message, mediaId = null, campaignId = null) {
    const messageTask = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      groupId,
      message,
      mediaId,
      campaignId,
      attempts: 0,
      createdAt: new Date()
    };

    this.queue.push(messageTask);

    if (!this.processing) {
      this.processQueue();
    }

    return messageTask.id;
  }

  async processQueue() {
    if (this.processing) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      await this.processMessage(task);
      
      // Delay between messages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.processing = false;
  }

  async processMessage(task) {
    console.log(`📤 Processing message: ${task.id}`);
    
    const session = sessionManager.getSession(task.sessionId);
    if (!session || session.data.status !== 'connected') {
      console.log(`❌ Session not ready for ${task.id}`);
      
      this.emitResult(session?.data.userId, {
        taskId: task.id,
        sessionId: task.sessionId,
        groupId: task.groupId,
        success: false,
        error: 'Session not connected'
      });
      
      await this.logFailedMessage(task, 'Session not connected');
      return;
    }

    try {
      console.log(`📞 Sending WhatsApp message...`);
      const result = await this.sendMessage(task);
      console.log(`✅ Message sent: ${result.id._serialized}`);
      
      // Update stats
      session.data.messagesSent = (session.data.messagesSent || 0) + 1;
      session.data.lastActivity = new Date();
      
      await this.logSuccessMessage(task, result);
      
      // Emit success
      this.emitResult(session.data.userId, {
        taskId: task.id,
        sessionId: task.sessionId,
        groupId: task.groupId,
        success: true,
        messageId: result.id._serialized,
        timestamp: new Date()
      });

    } catch (error) {
      console.error(`❌ Send failed: ${error.message}`);
      
      if (task.attempts < 2) {
        // Retry once
        task.attempts++;
        console.log(`🔄 Retrying ${task.id}`);
        setTimeout(() => {
          this.queue.unshift(task);
          if (!this.processing) this.processQueue();
        }, 3000);
      } else {
        // Final failure
        await this.logFailedMessage(task, error.message);
        
        this.emitResult(session.data.userId, {
          taskId: task.id,
          sessionId: task.sessionId,
          groupId: task.groupId,
          success: false,
          error: error.message,
          finalAttempt: true
        });
      }
    }
  }

  // Emit result with multiple strategies
  emitResult(userId, resultData) {
    console.log(`📡 Emitting result to user ${userId}:`, {
      taskId: resultData.taskId,
      success: resultData.success,
      error: resultData.error || 'none'
    });
    
    // Emit individual message result
    io.to(`user_${userId}`).emit('message-sent', resultData);
    
    const userSocket = sessionManager.userSockets.get(userId);
    if (userSocket && userSocket.connected) {
      userSocket.emit('message-sent', resultData);
    }

    // Also emit success/failure notification
    const notificationData = {
      type: resultData.success ? 'success' : 'error',
      title: resultData.success ? 'Message Sent' : 'Message Failed',
      message: resultData.success 
        ? `Message sent successfully to group` 
        : `Failed to send message: ${resultData.error}`,
      timestamp: new Date(),
      taskId: resultData.taskId
    };

    io.to(`user_${userId}`).emit('notification', notificationData);
    if (userSocket && userSocket.connected) {
      userSocket.emit('notification', notificationData);
    }
  }

  async sendMessage(task) {
    const session = sessionManager.getSession(task.sessionId);
    const { client } = session;
    
    if (task.mediaId) {
      const upload = await Upload.findById(task.mediaId);
      if (!upload) throw new Error('Media file not found');
      
      const media = MessageMedia.fromFilePath(upload.path);
      return await client.sendMessage(task.groupId, media, { caption: task.message });
    } else {
      return await client.sendMessage(task.groupId, task.message);
    }
  }

  async logSuccessMessage(task, result) {
    const session = sessionManager.getSession(task.sessionId);
    const group = session.data.groups?.find(g => g.id === task.groupId);
    
    await MessageLog.create({
      sessionId: task.sessionId,
      userId: session.data.userId,
      groupId: task.groupId,
      groupName: group?.name || 'Unknown Group',
      message: task.message,
      messageId: result.id._serialized,
      status: 'sent',
      retryCount: task.attempts
    });

    // Check if this is part of a bulk campaign
    if (task.campaignId) {
      this.updateBulkCampaignProgress(task.campaignId, task, true);
    }
  }

  async logFailedMessage(task, error) {
    const session = sessionManager.getSession(task.sessionId);
    if (!session) return;
    
    const group = session.data.groups?.find(g => g.id === task.groupId);
    
    await MessageLog.create({
      sessionId: task.sessionId,
      userId: session.data.userId,
      groupId: task.groupId,
      groupName: group?.name || 'Unknown Group',
      message: task.message,
      status: 'failed',
      error: error,
      retryCount: task.attempts
    });

    // Check if this is part of a bulk campaign
    if (task.campaignId) {
      this.updateBulkCampaignProgress(task.campaignId, task, false);
    }
  }

  // Create a new bulk campaign tracker
  createBulkCampaign(campaignId, userId, totalTasks) {
    this.bulkCampaigns.set(campaignId, {
      campaignId,
      userId,
      totalTasks,
      completedTasks: 0,
      successTasks: 0,
      failedTasks: 0,
      results: [],
      startTime: new Date()
    });
  }

  // Update bulk campaign progress
  updateBulkCampaignProgress(campaignId, task, success) {
    const campaign = this.bulkCampaigns.get(campaignId);
    if (!campaign) return;

    campaign.completedTasks++;
    
    if (success) {
      campaign.successTasks++;
    } else {
      campaign.failedTasks++;
    }

    campaign.results.push({
      taskId: task.id,
      sessionId: task.sessionId,
      groupId: task.groupId,
      success,
      timestamp: new Date()
    });

    // Emit progress
    const userSocket = sessionManager.userSockets.get(campaign.userId);
    if (userSocket) {
      userSocket.emit('bulk-message-progress', {
        campaignId,
        completed: campaign.completedTasks,
        total: campaign.totalTasks,
        success: campaign.successTasks,
        failed: campaign.failedTasks,
        progress: Math.round((campaign.completedTasks / campaign.totalTasks) * 100)
      });
    }

    // Check if campaign is complete
    if (campaign.completedTasks >= campaign.totalTasks) {
      this.completeBulkCampaign(campaignId);
    }
  }

  // Complete bulk campaign
  completeBulkCampaign(campaignId) {
    const campaign = this.bulkCampaigns.get(campaignId);
    if (!campaign) return;

    const userSocket = sessionManager.userSockets.get(campaign.userId);
    if (userSocket) {
      userSocket.emit('bulk-message-completed', {
        campaignId,
        results: campaign.results,
        summary: {
          total: campaign.totalTasks,
          success: campaign.successTasks,
          failed: campaign.failedTasks,
          duration: Date.now() - campaign.startTime.getTime()
        }
      });
    }

    // Clean up
    this.bulkCampaigns.delete(campaignId);
  }
}

// Initialize managers
const sessionManager = new SessionManager();
const messageQueue = new MessageQueue();

// Utility functions
function safeDelete(filePath, maxRetries = 3, delay = 1000) {
  return new Promise((resolve) => {
    let attempts = 0;
    
    const attemptDelete = () => {
      attempts++;
      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          console.log(`✅ Successfully deleted: ${filePath}`);
        }
        resolve(true);
      } catch (error) {
        if (error.code === 'EBUSY' && attempts < maxRetries) {
          console.log(`⏳ File busy, retrying in ${delay}ms (attempt ${attempts}/${maxRetries})`);
          setTimeout(attemptDelete, delay);
        } else {
          console.warn(`⚠️ Could not delete ${filePath}: ${error.message}`);
          resolve(false);
        }
      }
    };
    
    attemptDelete();
  });
}

// Ensure directories exist
const directories = ['./sessions', './uploads'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav|pdf|doc|docx|xls|xlsx|ppt|pptx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

app.use('/files', express.static('uploads'));

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || !user.isActive) {
      return res.status(403).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Socket authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || !user.isActive) {
      return next(new Error('User not found or inactive'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error: Invalid token'));
  }
};

// Initialize default user if none exists
async function initializeDefaultUser() {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const defaultPassword = process.env.DEFAULT_PASSWORD || 'admin123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      await User.create({
        username: 'admin',
        email: 'admin@whatsapp-manager.local',
        password: hashedPassword
      });
      
      console.log('✅ Default user created: admin / admin123');
    }
  } catch (error) {
    console.error('❌ Error creating default user:', error);
  }
}

// Cleanup functions
async function cleanupOldData() {
  try {
    // Clean old messages (30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const messageResult = await MessageLog.deleteMany({
      sentAt: { $lt: thirtyDaysAgo }
    });

    // Clean old uploads (90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const oldUploads = await Upload.find({
      uploadedAt: { $lt: ninetyDaysAgo }
    });

    for (const upload of oldUploads) {
      if (fs.existsSync(upload.path)) {
        await safeDelete(upload.path);
      }
      await Upload.findByIdAndDelete(upload._id);
    }

    // Clean old disconnected sessions (7 days inactive)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const oldSessions = await Session.deleteMany({
      status: 'disconnected',
      lastActivity: { $lt: sevenDaysAgo }
    });

    console.log(`✅ Cleanup: ${messageResult.deletedCount} messages, ${oldUploads.length} uploads, ${oldSessions.deletedCount} sessions`);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

// Schedule cleanup
cron.schedule('0 2 * * *', cleanupOldData);
cron.schedule('0 */6 * * *', () => {
  console.log(`📊 Active sessions: ${sessionManager.activeSessions.size}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const connectedSessions = sessionManager.getUserSessions(null, 'connected');
  
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    sessions: {
      active: sessionManager.activeSessions.size,
      connected: connectedSessions.length
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    }
  });
});

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.findOne({ 
      $or: [{ username }, { email: username }],
      isActive: true 
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        lastLogin: user.lastLogin,
        settings: user.settings
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/validate', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        lastLogin: req.user.lastLogin,
        settings: req.user.settings
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File upload endpoint
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/files/${req.file.filename}`;

    const uploadDoc = new Upload({
      userId: req.user._id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      url: fileUrl
    });

    await uploadDoc.save();

    res.json({
      success: true,
      file: {
        id: uploadDoc._id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: fileUrl,
        uploadedAt: uploadDoc.uploadedAt
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Enhanced API endpoints
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const userSessions = sessionManager.getUserSessions(req.user._id.toString());
    res.json(userSessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id.toString();

    const session = sessionManager.getSession(sessionId);
    if (!session || session.data.userId !== userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionManager.cleanupSession(sessionId, 'user_logout');
    await Session.deleteOne({ sessionId, userId });

    res.json({ success: true, sessionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/logout-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const userSessions = sessionManager.getUserSessions(userId);

    const cleanupPromises = userSessions.map(session => 
      sessionManager.cleanupSession(session.id, 'logout_all')
    );

    await Promise.allSettled(cleanupPromises);
    await Session.deleteMany({ userId });

    io.to(`user_${userId}`).emit('all-sessions-removed');

    res.json({
      success: true,
      message: `Logged out ${userSessions.length} sessions`,
      count: userSessions.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enhanced Socket.IO handling
io.use(authenticateSocket);

io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.user.username} (ID: ${socket.userId})`);
  
  socket.join(`user_${socket.userId}`);
  sessionManager.userSockets.set(socket.userId, socket);

  // Send current sessions
  const userSessions = sessionManager.getUserSessions(socket.userId);
  socket.emit('sessions-data', userSessions);

  // UPDATED create-session handler
  socket.on('create-session', async (data) => {
    const sessionId = data.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`🆕 Create session request: ${sessionId}`);
      await sessionManager.loadOrCreateSession(sessionId, socket, socket.userId);
    } catch (error) {
      console.error(`❌ Create session error:`, error);
      socket.emit('session-error', { sessionId, error: error.message });
    }
  });

  socket.on('toggle-group', (data) => {
    const { sessionId, groupId } = data;
    const session = sessionManager.getSession(sessionId);
    
    if (session && session.data.userId === socket.userId) {
      const group = session.data.groups?.find(g => g.id === groupId);
      if (group) {
        group.isSelected = !group.isSelected;
        socket.emit('group-toggled', {
          sessionId,
          groupId,
          isSelected: group.isSelected
        });
      }
    }
  });

  // FIXED send-message handler
  socket.on('send-message', async (data) => {
    try {
      console.log(`📨 Send message request:`, data);
      
      const { sessionId, groupId, message, mediaId } = data;
      
      if (!sessionId || !groupId || !message) {
        socket.emit('message-error', { 
          error: 'Missing required fields' 
        });
        return;
      }
      
      const session = sessionManager.getSession(sessionId);
      if (!session || session.data.userId !== socket.userId) {
        socket.emit('message-error', { 
          sessionId, groupId, error: 'Session not found' 
        });
        return;
      }

      if (session.data.status !== 'connected') {
        socket.emit('message-error', { 
          sessionId, groupId, 
          error: `Session not connected. Status: ${session.data.status}` 
        });
        return;
      }

      const group = session.data.groups?.find(g => g.id === groupId);
      if (!group) {
        socket.emit('message-error', { 
          sessionId, groupId, error: 'Group not found' 
        });
        return;
      }

      const taskId = await messageQueue.addMessage(sessionId, groupId, message, mediaId);
      
      socket.emit('message-queued', { 
        taskId, sessionId, groupId,
        groupName: group.name,
        timestamp: new Date()
      });

    } catch (error) {
      socket.emit('message-error', { 
        sessionId: data?.sessionId,
        groupId: data?.groupId,
        error: error.message 
      });
    }
  });

  socket.on('send-bulk-messages', async (data) => {
    try {
      const { sessionId, groupIds, message, mediaId, delay = 10000 } = data;
      const session = sessionManager.getSession(sessionId);
      
      if (!session || session.data.userId !== socket.userId) {
        socket.emit('bulk-message-error', { error: 'Session not found' });
        return;
      }

      if (session.data.status !== 'connected') {
        socket.emit('bulk-message-error', { 
          error: `Session not connected. Status: ${session.data.status}` 
        });
        return;
      }

      if (!groupIds || groupIds.length === 0) {
        socket.emit('bulk-message-error', { error: 'No groups selected' });
        return;
      }

      // Create campaign ID and tracker
      const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      messageQueue.createBulkCampaign(campaignId, socket.userId, groupIds.length);

      socket.emit('bulk-message-started', { 
        campaignId,
        sessionId, 
        totalGroups: groupIds.length 
      });

      console.log(`📤 Starting bulk campaign ${campaignId} with ${groupIds.length} groups`);

      // Queue messages with staggered delays
      const taskIds = [];
      for (let i = 0; i < groupIds.length; i++) {
        const groupId = groupIds[i];
        const group = session.data.groups?.find(g => g.id === groupId);
        
        setTimeout(async () => {
          try {
            const taskId = await messageQueue.addMessage(
              sessionId, 
              groupId, 
              message, 
              mediaId,
              campaignId
            );
            taskIds.push(taskId);
            
            console.log(`📝 Queued message ${i + 1}/${groupIds.length} to ${group?.name || groupId}`);
          } catch (error) {
            console.error(`❌ Failed to queue message to group ${groupId}:`, error);
          }
        }, i * (delay + (Math.random() * 2000))); // Add random delay to avoid rate limiting
      }

      socket.emit('bulk-message-queued', { 
        campaignId,
        sessionId, 
        taskIds,
        message: `Queued ${groupIds.length} messages for sending`
      });

    } catch (error) {
      console.error('❌ Bulk message error:', error);
      socket.emit('bulk-message-error', { 
        sessionId: data.sessionId, 
        error: error.message 
      });
    }
  });

  socket.on('refresh-groups', async (data) => {
    const { sessionId } = data;
    const session = sessionManager.getSession(sessionId);
    
    if (!session || session.data.userId !== socket.userId) {
      socket.emit('access-denied', { sessionId });
      return;
    }

    if (session.data.status !== 'connected') {
      socket.emit('groups-error', { 
        sessionId, 
        error: 'Session not connected' 
      });
      return;
    }

    try {
      await sessionManager.fetchAndSaveGroups(sessionId, session.client, socket);
    } catch (error) {
      socket.emit('groups-error', { sessionId, error: error.message });
    }
  });

  socket.on('logout-session', async (data) => {
    try {
      const { sessionId } = data;
      const session = sessionManager.getSession(sessionId);
      
      if (!session || session.data.userId !== socket.userId) {
        socket.emit('logout-error', { sessionId, error: 'Session not found' });
        return;
      }

      await sessionManager.cleanupSession(sessionId, 'user_logout');
      await Session.deleteOne({ sessionId, userId: socket.userId });

      socket.emit('logout-success', { sessionId });

    } catch (error) {
      socket.emit('logout-error', { 
        sessionId: data.sessionId, 
        error: error.message 
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`📱 Client disconnected: ${socket.user.username}`);
    sessionManager.userSockets.delete(socket.userId);
  });
});

// Additional API endpoints
app.get('/api/sessions/:sessionId/groups', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);

    if (!session || session.data.userId !== req.user._id.toString()) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      sessionId,
      groups: session.data.groups || [],
      phoneNumber: session.data.phoneNumber,
      status: session.data.status
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/logs', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, sessionId, status } = req.query;
    const query = { userId: req.user._id };
    
    if (sessionId) query.sessionId = sessionId;
    if (status) query.status = status;

    const messages = await MessageLog.find(query)
      .sort({ sentAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await MessageLog.countDocuments(query);

    res.json({
      messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const userSessions = sessionManager.getUserSessions(userId.toString());
    
    const connectedSessions = userSessions.filter(s => s.status === 'connected');
    const totalGroups = userSessions.reduce((sum, s) => sum + (s.groupCount || 0), 0);
    
    const totalMessages = await MessageLog.countDocuments({ userId });
    const todayMessages = await MessageLog.countDocuments({
      userId,
      sentAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });

    const failedMessages = await MessageLog.countDocuments({
      userId,
      status: 'failed'
    });

    res.json({
      sessions: {
        total: userSessions.length,
        connected: connectedSessions.length,
        totalGroups
      },
      messages: {
        total: totalMessages,
        today: todayMessages,
        failed: failedMessages,
        successRate: totalMessages > 0 ? ((totalMessages - failedMessages) / totalMessages * 100).toFixed(1) : 0
      },
      lastLogin: req.user.lastLogin
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User settings endpoint
app.put('/api/user/settings', authenticateToken, async (req, res) => {
  try {
    const { bulkMessageDelay, maxRetries, autoReconnect } = req.body;
    
    const updateData = {};
    if (bulkMessageDelay !== undefined) updateData['settings.bulkMessageDelay'] = bulkMessageDelay;
    if (maxRetries !== undefined) updateData['settings.maxRetries'] = maxRetries;
    if (autoReconnect !== undefined) updateData['settings.autoReconnect'] = autoReconnect;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, select: '-password' }
    );

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Express error:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large' });
  }
  
  if (error.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  
  const cleanupPromises = Array.from(sessionManager.activeSessions.keys())
    .map(sessionId => sessionManager.cleanupSession(sessionId, 'shutdown'));
  
  await Promise.allSettled(cleanupPromises);
  await mongoose.disconnect();
  
  console.log('✅ Server shutdown complete');
  process.exit(0);
});

// Start server
async function startServer() {
  await initializeDefaultUser();
  
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Enhanced WhatsApp Server running on port ${PORT}`);
    console.log(`🔐 Features: Database Persistence, Smart Reconnect, Message Queue`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📊 Health Check: http://localhost:${PORT}/health`);
    console.log(`👤 Default Login: admin / admin123`);
  });
}

startServer().catch(console.error);