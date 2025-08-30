import React, { useState } from 'react';
import { Plus, Smartphone, Users, Wifi, WifiOff, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useCampaign } from '../contexts/CampaignContext';
import SessionCard from './SessionCard';
import GroupList from './GroupList';
import CampaignComposer from './CampaignComposer';
import io from 'socket.io-client';
const socket = io('http://localhost:3001');

const Dashboard: React.FC = () => {
  const { 
    sessions, 
    isConnected, 
    createSession, 
    disconnectSession,
    refreshGroups,
    getTotalSelectedGroups,
    toggleGroupSelection // ✅ Extract this at component level
  } = useCampaign();
  const [activeTab, setActiveTab] = useState<'sessions' | 'groups' | 'campaigns'>('sessions');
  const [refreshingSession, setRefreshingSession] = useState<string | null>(null);

  const connectedSessions = sessions.filter(s => s.status === 'connected');
  const totalGroups = sessions.reduce((total, session) => total + session.groups.length, 0);
  const selectedGroups = getTotalSelectedGroups();
  // In your React component
socket.on('client-ready', (data) => {
  console.log('Client ready:', data);
  
  // Wait 35 seconds then check if groups loaded
  setTimeout(() => {
    socket.emit('debug-session', { sessionId: data.sessionId });
  }, 35000);
});

socket.on('debug-info', (data) => {
  console.log('Debug info:', data);
  
  // If groups not loaded, try manual refresh
  if (!data.session?.groupsLoaded) {
    console.log('Groups not loaded, trying refresh...');
    socket.emit('refresh-groups', { sessionId: data.sessionId });
  }
});

  // Handle session refresh
  const handleRefreshGroups = async (sessionId: string) => {
    setRefreshingSession(sessionId);
    refreshGroups(sessionId);
    
    // Clear refreshing state after 3 seconds
    setTimeout(() => {
      setRefreshingSession(null);
    }, 3000);
  };

  // Handle session deletion
  const handleDeleteSession = (sessionId: string) => {
    if (confirm('Are you sure you want to disconnect this WhatsApp account?')) {
      disconnectSession(sessionId);
    }
  };

  // ✅ Handle group toggle - now using the extracted function
  const handleGroupToggle = (sessionId: string, groupId: string) => {
    toggleGroupSelection(sessionId, groupId);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Smartphone className="h-8 w-8 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">WhatsApp Campaign Manager</h1>
              <p className="text-gray-400">Manage up to 10 WhatsApp accounts</p>
            </div>
          </div>
          
          {/* Connection Status */}
          <div className="flex items-center space-x-3">
            {isConnected ? (
              <div className="flex items-center space-x-2 text-green-400">
                <Wifi className="h-5 w-5" />
                <span className="text-sm font-medium">Connected</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-red-400">
                <WifiOff className="h-5 w-5" />
                <span className="text-sm font-medium">Disconnected</span>
              </div>
            )}
            
            <button
              onClick={createSession}
              disabled={sessions.length >= 10 || !isConnected}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>Add Account</span>
              <span className="bg-blue-800 text-xs px-2 py-1 rounded-full">
                {sessions.length}/10
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-gray-800 px-6 py-4 border-b border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
              <div>
                <p className="text-sm text-gray-400">Connected Accounts</p>
                <p className="text-xl font-bold">{connectedSessions.length}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Users className="h-6 w-6 text-blue-400" />
              <div>
                <p className="text-sm text-gray-400">Total Groups</p>
                <p className="text-xl font-bold">{totalGroups}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-6 w-6 text-amber-400" />
              <div>
                <p className="text-sm text-gray-400">Selected Groups</p>
                <p className="text-xl font-bold">{selectedGroups}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Smartphone className="h-6 w-6 text-purple-400" />
              <div>
                <p className="text-sm text-gray-400">Available Slots</p>
                <p className="text-xl font-bold">{10 - sessions.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="px-6 py-4 border-b border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'sessions', label: 'WhatsApp Sessions', count: sessions.length },
            { id: 'groups', label: 'Groups', count: totalGroups },
            { id: 'campaigns', label: 'Campaigns', count: 0 },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className="bg-gray-600 text-xs px-2 py-1 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'sessions' && (
          <div className="space-y-6">
            {sessions.length === 0 ? (
              <div className="text-center py-12">
                <Smartphone className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-300 mb-2">No WhatsApp accounts connected</h3>
                <p className="text-gray-500 mb-6">Connect your first WhatsApp account to start managing campaigns</p>
                <button
                  onClick={createSession}
                  disabled={!isConnected}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  {isConnected ? 'Connect WhatsApp Account' : 'Connecting to Server...'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {sessions.map((session) => (
                  <div key={session.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    {/* Session Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <Smartphone className="h-6 w-6 text-blue-400" />
                        <div>
                          <h3 className="font-semibold text-white">
                            {session.phoneNumber ? `+${session.phoneNumber}` : session.id.slice(-8)}
                          </h3>
                          <p className="text-sm text-gray-400 capitalize">{session.status.replace('_', ' ')}</p>
                        </div>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex items-center space-x-2">
                        {session.status === 'connected' && (
                          <button
                            onClick={() => handleRefreshGroups(session.id)}
                            disabled={refreshingSession === session.id}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                            title="Refresh Groups"
                          >
                            <RefreshCw 
                              className={`h-4 w-4 ${refreshingSession === session.id ? 'animate-spin' : ''}`} 
                            />
                          </button>
                        )}
                        
                        <button
                          onClick={() => handleDeleteSession(session.id)}
                          className="p-2 text-red-400 hover:text-red-300 transition-colors"
                          title="Disconnect Session"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Session Content */}
                    {session.status === 'waiting_for_scan' && session.qrCode && (
                      <div className="text-center">
                        <img 
                          src={session.qrCode} 
                          alt="QR Code" 
                          className="mx-auto mb-3 rounded-lg bg-white p-2"
                          style={{ width: '200px', height: '200px' }}
                        />
                        <p className="text-sm text-gray-400">Scan QR code with WhatsApp</p>
                      </div>
                    )}

                    {session.status === 'loading' && (
                      <div className="text-center">
                        <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full mx-auto mb-3"></div>
                        <p className="text-sm text-gray-400">
                          Loading... {session.loadingPercent}%
                        </p>
                        {session.loadingMessage && (
                          <p className="text-xs text-gray-500 mt-1">{session.loadingMessage}</p>
                        )}
                      </div>
                    )}

                    {session.status === 'connected' && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-gray-400">Groups</span>
                          <div className="flex items-center space-x-2">
                            {session.groupsLoading ? (
                              <div className="flex items-center space-x-2 text-blue-400">
                                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs">Loading...</span>
                              </div>
                            ) : (
                              <span className="text-lg font-bold text-white">{session.groups.length}</span>
                            )}
                          </div>
                        </div>
                        
                        {session.groupsLoading && session.loadingPercent && (
                          <div className="mb-3">
                            <div className="bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-blue-400 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${session.loadingPercent}%` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              Loading groups... {session.loadingPercent}%
                            </p>
                          </div>
                        )}

                        {session.groups.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-sm text-gray-400">
                              Selected: {session.groups.filter(g => g.isSelected).length} groups
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {session.status === 'initializing' && (
                      <div className="text-center">
                        <div className="animate-pulse h-4 w-4 bg-blue-400 rounded-full mx-auto mb-3"></div>
                        <p className="text-sm text-gray-400">Initializing WhatsApp session...</p>
                      </div>
                    )}

                    {session.status === 'authenticated' && (
                      <div className="text-center">
                        <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-3" />
                        <p className="text-sm text-gray-400">Authentication successful</p>
                      </div>
                    )}

                    {session.status === 'auth_failure' && (
                      <div className="text-center">
                        <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
                        <p className="text-sm text-red-400">Authentication failed</p>
                        <button
                          onClick={() => handleDeleteSession(session.id)}
                          className="mt-2 text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Remove session
                        </button>
                      </div>
                    )}

                    {session.status === 'disconnected' && (
                      <div className="text-center">
                        <WifiOff className="h-8 w-8 text-gray-500 mx-auto mb-3" />
                        <p className="text-sm text-gray-400">Disconnected</p>
                        <button
                          onClick={() => handleDeleteSession(session.id)}
                          className="mt-2 text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Remove session
                        </button>
                      </div>
                    )}

                    {/* Session Footer */}
                    <div className="mt-4 pt-3 border-t border-gray-700">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>Session ID: {session.id.slice(-8)}</span>
                        {session.lastActivity && (
                          <span>
                            Last active: {new Date(session.lastActivity).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="space-y-6">
            {connectedSessions.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-300 mb-2">No connected accounts</h3>
                <p className="text-gray-500">Connect a WhatsApp account first to see your groups</p>
              </div>
            ) : (
              <div className="space-y-8">
                {connectedSessions.map((session) => (
                  <div key={session.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    {/* Session Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center space-x-3">
                        <Smartphone className="h-6 w-6 text-blue-400" />
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            {session.phoneNumber ? `+${session.phoneNumber}` : session.id.slice(-8)}
                          </h3>
                          <p className="text-sm text-gray-400">
                            {session.groupsLoading ? (
                              <span className="flex items-center space-x-2">
                                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                <span>Loading groups...</span>
                              </span>
                            ) : (
                              `${session.groups.length} groups • ${session.groups.filter(g => g.isSelected).length} selected`
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleRefreshGroups(session.id)}
                        disabled={refreshingSession === session.id || session.groupsLoading}
                        className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        <RefreshCw 
                          className={`h-4 w-4 ${refreshingSession === session.id ? 'animate-spin' : ''}`} 
                        />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Groups Loading Progress */}
                    {session.groupsLoading && session.loadingPercent && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                          <span>Loading groups...</span>
                          <span>{session.loadingPercent}%</span>
                        </div>
                        <div className="bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-blue-400 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${session.loadingPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                    

                    {/* Groups List */}
                    {session.groups.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {session.groups.map((group) => (
                          <div
                            key={group.id}
                            className={`p-4 rounded-lg border cursor-pointer transition-all ${
                              group.isSelected
                                ? 'bg-blue-900 border-blue-500'
                                : 'bg-gray-900 border-gray-600 hover:border-gray-500'
                            }`}
                            onClick={() => handleGroupToggle(session.id, group.id)} // ✅ Fixed - now using the extracted function
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-white truncate">{group.name}</h4>
                                <p className="text-sm text-gray-400">
                                  {group.participantCount} members
                                </p>
                                {group.unreadCount && group.unreadCount > 0 && (
                                  <p className="text-xs text-amber-400">
                                    {group.unreadCount} unread
                                  </p>
                                )}
                              </div>
                              <div className="ml-3 flex-shrink-0">
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                  group.isSelected
                                    ? 'bg-blue-500 border-blue-500'
                                    : 'border-gray-400'
                                }`}>
                                  {group.isSelected && (
                                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : !session.groupsLoading ? (
                      <div className="text-center py-8">
                        <Users className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-400">No groups found</p>
                        <button
                          onClick={() => handleRefreshGroups(session.id)}
                          className="mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Try refreshing
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'campaigns' && (
          <div className="space-y-6">
            {React.createElement(CampaignComposer as any, { socket })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;