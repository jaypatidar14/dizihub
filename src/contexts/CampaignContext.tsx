import React, { createContext, useContext, useReducer, useEffect, ReactNode, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface WhatsAppGroup {
  id: string;
  name: string;
  participantCount: number;
  isSelected: boolean;
  tags: string[];
  lastActivity?: number;
  unreadCount?: number;
  isArchived?: boolean;
}

export interface WhatsAppSession {
  id: string;
  status: 'disconnected' | 'initializing' | 'waiting_for_scan' | 'authenticated' | 'loading' | 'connected' | 'auth_failure';
  phoneNumber?: string;
  qrCode?: string;
  groups: WhatsAppGroup[];
  lastActivity?: Date;
  groupsLoaded?: boolean;
  groupsLoading?: boolean;
  loadingPercent?: number;
  loadingMessage?: string;
}

interface CampaignState {
  sessions: WhatsAppSession[];
  socket: Socket | null;
  isConnected: boolean;
  isLoading: boolean;
}

type CampaignAction =
  | { type: 'SET_SOCKET'; payload: Socket }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'UPDATE_SESSIONS'; payload: WhatsAppSession[] }
  | { type: 'UPDATE_SESSION'; payload: { sessionId: string; updates: Partial<WhatsAppSession> } }
  | { type: 'ADD_SESSION'; payload: WhatsAppSession }
  | { type: 'REMOVE_SESSION'; payload: string }
  | { type: 'CLEAR_DISCONNECTED_SESSIONS' }
  | { type: 'UPDATE_GROUPS'; payload: { sessionId: string; groups: WhatsAppGroup[] } }
  | { type: 'UPDATE_GROUPS_BATCH'; payload: { sessionId: string; groups: WhatsAppGroup[]; isComplete: boolean; progress?: number } }
  | { type: 'SET_GROUPS_LOADING'; payload: { sessionId: string; loading: boolean } }
  | { type: 'TOGGLE_GROUP'; payload: { sessionId: string; groupId: string } }
  | { type: 'SET_GROUP_SELECTION'; payload: { sessionId: string; groupId: string; isSelected: boolean } };

const initialState: CampaignState = {
  sessions: [],
  socket: null,
  isConnected: false,
  isLoading: false,
};

function campaignReducer(state: CampaignState, action: CampaignAction): CampaignState {
  switch (action.type) {
    case 'SET_SOCKET':
      return { ...state, socket: action.payload };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'UPDATE_SESSIONS':
      // Filter out any disconnected sessions and merge with existing
      const activeSessions = action.payload.filter(session => session.status !== 'disconnected');
      return { ...state, sessions: activeSessions };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? { ...session, ...action.payload.updates }
            : session
        ),
      };
    case 'ADD_SESSION':
      // Check if session already exists before adding
      const existingIndex = state.sessions.findIndex(s => s.id === action.payload.id);
      if (existingIndex !== -1) {
        // Update existing session
        return {
          ...state,
          sessions: state.sessions.map((session, index) =>
            index === existingIndex ? action.payload : session
          ),
        };
      }
      return {
        ...state,
        sessions: [...state.sessions, action.payload],
      };
    case 'REMOVE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter(session => session.id !== action.payload),
      };
    case 'CLEAR_DISCONNECTED_SESSIONS':
      return {
        ...state,
        sessions: state.sessions.filter(session => session.status !== 'disconnected'),
      };
    case 'UPDATE_GROUPS':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? { 
                ...session, 
                groups: action.payload.groups,
                groupsLoaded: true,
                groupsLoading: false
              }
            : session
        ),
      };
    case 'UPDATE_GROUPS_BATCH':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? { 
                ...session, 
                groups: [...session.groups, ...action.payload.groups],
                groupsLoaded: action.payload.isComplete,
                groupsLoading: !action.payload.isComplete,
                loadingPercent: action.payload.progress
              }
            : session
        ),
      };
    case 'SET_GROUPS_LOADING':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? { 
                ...session, 
                groupsLoading: action.payload.loading,
                groups: action.payload.loading ? [] : session.groups
              }
            : session
        ),
      };
    case 'TOGGLE_GROUP':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? {
                ...session,
                groups: session.groups.map(group =>
                  group.id === action.payload.groupId
                    ? { ...group, isSelected: !group.isSelected }
                    : group
                ),
              }
            : session
        ),
      };

    case 'SET_GROUP_SELECTION':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.sessionId
            ? {
                ...session,
                groups: session.groups.map(group =>
                  group.id === action.payload.groupId
                    ? { ...group, isSelected: action.payload.isSelected }
                    : group
                ),
              }
            : session
        ),
      };

    default:
      return state;
  }
}

interface CampaignContextType extends CampaignState {
  createSession: () => void;
  disconnectSession: (sessionId: string) => void;
  refreshGroups: (sessionId: string) => void;
  toggleGroupSelection: (sessionId: string, groupId: string) => void;
  getSelectedGroups: (sessionId: string) => WhatsAppGroup[];
  getTotalSelectedGroups: () => number;
  clearDisconnectedSessions: () => void;
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

export const useCampaign = () => {
  const context = useContext(CampaignContext);
  if (context === undefined) {
    throw new Error('useCampaign must be used within a CampaignProvider');
  }
  return context;
};

interface CampaignProviderProps {
  children: ReactNode;
}

export const CampaignProvider: React.FC<CampaignProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(campaignReducer, initialState);

  useEffect(() => {
    // Initialize socket connection with reconnection options
    const socket = io('http://localhost:3001', {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000,
    });

    dispatch({ type: 'SET_SOCKET', payload: socket });

    // Socket event listeners
    socket.on('connect', () => {
      console.log('Connected to server');
      dispatch({ type: 'SET_CONNECTED', payload: true });
      
      // Clear disconnected sessions on reconnect
      dispatch({ type: 'CLEAR_DISCONNECTED_SESSIONS' });
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      dispatch({ type: 'SET_CONNECTED', payload: false });
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      dispatch({ type: 'SET_CONNECTED', payload: false });
    });

    // Receive initial sessions data (only active sessions)
    socket.on('sessions-data', (sessions: any[]) => {
      console.log('Received sessions data:', sessions);
      const formattedSessions: WhatsAppSession[] = sessions
        .filter(session => session.status !== 'disconnected') // Filter out disconnected
        .map(session => ({
          id: session.id,
          status: session.status,
          phoneNumber: session.phoneNumber,
          qrCode: session.qrCode,
          groups: session.groups || [],
          lastActivity: session.lastActivity ? new Date(session.lastActivity) : undefined,
          groupsLoaded: session.groupsLoaded || false,
          groupsLoading: false,
        }));
      dispatch({ type: 'UPDATE_SESSIONS', payload: formattedSessions });
    });

    // Handle QR code updates
    socket.on('qr-code', (data: any) => {
      console.log('QR code received for session:', data.sessionId);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            qrCode: data.qrCode,
            status: data.status,
          },
        },
      });
    });

    // Handle loading screen
    socket.on('loading', (data: any) => {
      console.log('Loading screen:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'loading',
            loadingPercent: data.percent,
            loadingMessage: data.message,
          },
        },
      });
    });

    // Handle authentication success
    socket.on('authenticated', (data: any) => {
      console.log('Authenticated:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'authenticated',
            qrCode: undefined,
          },
        },
      });
    });

    // Handle session updates
    socket.on('session-update', (data: any) => {
      console.log('Session update:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: data.status,
            phoneNumber: data.phoneNumber,
            qrCode: data.qrCode,
            groups: data.groups || [],
            loadingPercent: data.loadingPercent,
            loadingMessage: data.loadingMessage,
          },
        },
      });
    });

    // Handle client ready
    socket.on('client-ready', (data: any) => {
      console.log('Client ready:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'connected',
            phoneNumber: data.phoneNumber,
            qrCode: undefined,
            groups: data.groups || [],
          },
        },
      });
    });

    // Handle groups loading
    socket.on('groups-loading', (data: any) => {
      console.log('Groups loading:', data);
      dispatch({
        type: 'SET_GROUPS_LOADING',
        payload: {
          sessionId: data.sessionId,
          loading: true,
        },
      });
    });

    // Handle groups batch update
    socket.on('groups-batch-update', (data: any) => {
      console.log('Groups batch update:', data);
      dispatch({
        type: 'UPDATE_GROUPS_BATCH',
        payload: {
          sessionId: data.sessionId,
          groups: data.groups,
          isComplete: data.isComplete,
          progress: data.progress,
        },
      });
    });

    // Handle groups data
    socket.on('groups-data', (data: any) => {
      console.log('Groups data received:', data);
      dispatch({
        type: 'UPDATE_GROUPS',
        payload: {
          sessionId: data.sessionId,
          groups: data.groups,
        },
      });
    });

    // Handle groups loaded
    socket.on('groups-loaded', (data: any) => {
      console.log('Groups loaded:', data);
      dispatch({
        type: 'UPDATE_GROUPS',
        payload: {
          sessionId: data.sessionId,
          groups: data.groups,
        },
      });
    });

    // Handle groups error
    socket.on('groups-error', (data: any) => {
      console.error('Groups error:', data);
      dispatch({
        type: 'SET_GROUPS_LOADING',
        payload: {
          sessionId: data.sessionId,
          loading: false,
        },
      });
    });

    // Handle authentication failure
    socket.on('auth-failure', (data: any) => {
      console.log('Auth failure:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'auth_failure',
          },
        },
      });
    });

    // Handle disconnection
    socket.on('disconnected', (data: any) => {
      console.log('Session disconnected:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'disconnected',
            groups: [], // Clear groups when disconnected
          },
        },
      });
    });

    // Handle session disconnected (manual disconnect) - REMOVE FROM UI
    socket.on('session-disconnected', (data: any) => {
      console.log('Session manually disconnected:', data);
      dispatch({
        type: 'REMOVE_SESSION',
        payload: data.sessionId,
      });
    });

    // Handle session removed (server cleanup) - REMOVE FROM UI
    socket.on('session-removed', (data: any) => {
      console.log('Session removed by server:', data);
      dispatch({
        type: 'REMOVE_SESSION',
        payload: data.sessionId,
      });
    });

    // Handle group toggle response
    socket.on('group-toggled', (data: any) => {
      // server sends isSelected boolean — apply it explicitly (avoids double-toggle)
      dispatch({
        type: 'SET_GROUP_SELECTION',
        payload: {
          sessionId: data.sessionId,
          groupId: data.groupId,
          isSelected: data.isSelected
        },
      });
    });

    // Handle group updates from other clients
    socket.on('group-update', (data: any) => {
      dispatch({
        type: 'SET_GROUP_SELECTION',
        payload: {
          sessionId: data.sessionId,
          groupId: data.groupId,
          isSelected: data.isSelected
        },
      });
    });

    // Handle session limits
    socket.on('session-limit-reached', (data: any) => {
      alert(data.message);
    });

    // Handle existing session
    socket.on('session-exists', (data: any) => {
      console.log('Session already exists:', data.sessionId);
      // Don't create a new session, just update existing if needed
    });

    // Handle QR timeout
    socket.on('qr-timeout', (data: any) => {
      console.log('QR timeout:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'disconnected',
            qrCode: undefined,
          },
        },
      });
    });

    // Handle initialization error
    socket.on('initialization-error', (data: any) => {
      console.error('Initialization error:', data);
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          sessionId: data.sessionId,
          updates: {
            status: 'auth_failure',
          },
        },
      });
    });

    // Handle session error
    socket.on('session-error', (data: any) => {
      console.error('Session error:', data);
      alert(`Session error: ${data.error}`);
    });

    return () => {
      socket.close();
    };
  }, []);

  const createSession = () => {
    if (state.sessions.length >= 10) {
      alert('Maximum 10 WhatsApp accounts allowed per seller');
      return;
    }

    if (!state.isConnected) {
      alert('Not connected to server. Please wait...');
      return;
    }

    const sessionId = `session_${Date.now()}`;
    const newSession: WhatsAppSession = {
      id: sessionId,
      status: 'initializing',
      groups: [],
      groupsLoaded: false,
      groupsLoading: false,
    };

    dispatch({ type: 'ADD_SESSION', payload: newSession });

    if (state.socket) {
      state.socket.emit('create-session', { sessionId });
    }
  };

  const disconnectSession = (sessionId: string) => {
    console.log('Disconnecting session:', sessionId);
    
    if (!confirm('Are you sure you want to disconnect this WhatsApp session? This will permanently remove all data.')) {
      return;
    }

    // Immediately update UI to show disconnecting state
    dispatch({
      type: 'UPDATE_SESSION',
      payload: {
        sessionId,
        updates: {
          status: 'disconnected',
        },
      },
    });

    if (state.socket) {
      state.socket.emit('disconnect-session', { sessionId });
    } else {
      // If no socket connection, remove immediately
      dispatch({ type: 'REMOVE_SESSION', payload: sessionId });
    }
  };

  const refreshGroups = (sessionId: string) => {
    console.log('Refreshing groups for session:', sessionId);
    
    if (state.socket) {
      dispatch({
        type: 'SET_GROUPS_LOADING',
        payload: {
          sessionId,
          loading: true,
        },
      });
      
      state.socket.emit('refresh-groups', { sessionId });
    }
  };

  useEffect(() => {
    if (!state.socket) return;

    const socket = state.socket;

    const onGroupToggled = (data: any) => {
      // Server sends authoritative isSelected boolean — apply it explicitly
      dispatch({
        type: 'SET_GROUP_SELECTION',
        payload: {
          sessionId: data.sessionId,
          groupId: data.groupId,
          isSelected: !!data.isSelected,
        },
      });
    };

    const onGroupUpdate = (data: any) => {
      dispatch({
        type: 'SET_GROUP_SELECTION',
        payload: {
          sessionId: data.sessionId,
          groupId: data.groupId,
          isSelected: !!data.isSelected,
        },
      });
    };

    socket.on('group-toggled', onGroupToggled);
    socket.on('group-update', onGroupUpdate);

    return () => {
      socket.off('group-toggled', onGroupToggled);
      socket.off('group-update', onGroupUpdate);
    };
  }, [state.socket]);

  // Provide a toggleGroupSelection function that only emits — do NOT update local state here
  const toggleGroupSelection = useCallback((sessionId: string, groupId: string) => {
    if (!state.socket) return;
    console.log('Emitting toggle-group:', { sessionId, groupId });
    
    // Emit the toggle event to server
    state.socket.emit('toggle-group', { sessionId, groupId });
    
    // Optional: Optimistic update
    dispatch({
      type: 'SET_GROUP_SELECTION',
      payload: {
        sessionId,
        groupId,
        // Find current selection state and toggle it
        isSelected: !state.sessions
          .find(s => s.id === sessionId)
          ?.groups.find(g => g.id === groupId)
          ?.isSelected
      }
    });
  }, [state.socket, state.sessions]);

  const getSelectedGroups = (sessionId: string): WhatsAppGroup[] => {
    const session = state.sessions.find(s => s.id === sessionId);
    return session ? session.groups.filter(group => group.isSelected) : [];
  };

  const getTotalSelectedGroups = (): number => {
    return state.sessions.reduce((total, session) => {
      return total + session.groups.filter(group => group.isSelected).length;
    }, 0);
  };

  const clearDisconnectedSessions = () => {
    dispatch({ type: 'CLEAR_DISCONNECTED_SESSIONS' });
  };

  const contextValue: CampaignContextType = {
    ...state,
    toggleGroupSelection,
    createSession,
    disconnectSession,
    refreshGroups,
    getSelectedGroups,
    getTotalSelectedGroups,
    clearDisconnectedSessions,
  };

  return (
    <CampaignContext.Provider value={contextValue}>
      {children}
    </CampaignContext.Provider>
  );
};