import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Image, 
  Video, 
  Clock,
  Users,
  AlertTriangle,
  Play,
  Pause,
  Settings,
  CheckCircle,
  Smartphone,
  MessageSquare
} from 'lucide-react';
import { useCampaign } from '../contexts/CampaignContext';
import { useNotifications } from '../contexts/NotificationContext';

const CampaignComposer: React.FC = () => {
  const { sessions, getTotalSelectedGroups, socket } = useCampaign();
  const { showSuccess, showError, showInfo, showWarning, addNotification } = useNotifications();
  const [message, setMessage] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [delayBetweenMessages, setDelayBetweenMessages] = useState(5);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendingProgress, setSendingProgress] = useState({ sent: 0, total: 0, currentGroup: '' });
  const [campaignResults, setCampaignResults] = useState<any[]>([]);

  const connectedSessions = sessions.filter(s => s.status === 'connected');
  const totalSelectedGroups = getTotalSelectedGroups();
  const estimatedTime = totalSelectedGroups * delayBetweenMessages;

  // Get detailed selection info for each session
  const sessionSelectionInfo = connectedSessions.map(session => {
    const selectedGroups = session.groups.filter(g => g.isSelected);
    return {
      sessionId: session.id,
      phoneNumber: session.phoneNumber || session.id,
      selectedCount: selectedGroups.length,
      totalGroups: session.groups.length,
      selectedGroups: selectedGroups
    };
  }).filter(info => info.selectedCount > 0);

  // Socket event listeners for real-time campaign progress
  useEffect(() => {
    if (!socket) return;

    // Listen for individual message results
    const handleMessageSent = (data: any) => {
      console.log('Message sent result:', data);
      
      if (data.success) {
        showSuccess('Message Sent', `Message delivered successfully`);
      } else {
        showError('Message Failed', `Failed to send message: ${data.error}`);
      }
    };

    // Listen for notifications from server
    const handleNotification = (data: any) => {
      console.log('Server notification:', data);
      
      addNotification({
        type: data.type,
        title: data.title,
        message: data.message,
        duration: data.type === 'success' ? 3000 : 5000,
        taskId: data.taskId
      });
    };

    // Listen for bulk message progress
    const handleBulkProgress = (data: any) => {
      console.log('Bulk message progress:', data);
      setSendingProgress({
        sent: data.completed || data.progress?.sent || 0,
        total: data.total || data.progress?.total || 0,
        currentGroup: data.currentGroup || data.progress?.current || ''
      });

      // Show progress notification
      if (data.completed && data.total) {
        showInfo(
          'Campaign Progress', 
          `Sent ${data.completed}/${data.total} messages (${data.success} successful, ${data.failed} failed)`
        );
      }
    };

    // Listen for bulk message completion
    const handleBulkCompleted = (data: any) => {
      console.log('Bulk message completed:', data);
      setIsSending(false);
      setCampaignResults(data.results);
      
      const successCount = data.summary.success;
      const totalCount = data.summary.total;
      const failedCount = data.summary.failed;
      
      // Show completion notification with detailed results
      if (successCount === totalCount) {
        showSuccess(
          'Campaign Completed Successfully!', 
          `All ${totalCount} messages were sent successfully. Duration: ${Math.round(data.summary.duration / 1000)}s`
        );
      } else if (successCount > 0) {
        showWarning(
          'Campaign Completed with Issues', 
          `Sent ${successCount}/${totalCount} messages successfully. ${failedCount} failed.`
        );
      } else {
        showError(
          'Campaign Failed', 
          `All ${totalCount} messages failed to send. Please check your connection and try again.`
        );
      }
      
      // Reset form after successful send
      if (successCount > 0) {
        setMessage('');
        setCampaignName('');
        setMediaUrl('');
        setMediaType(null);
        setIsScheduled(false);
        setScheduledDate('');
        setScheduledTime('');
        setSendingProgress({ sent: 0, total: 0, currentGroup: '' });
      }
    };

    // Listen for bulk message errors
    const handleBulkError = (data: any) => {
      console.error('Bulk message error:', data);
      setIsSending(false);
      showError('Campaign Failed', `Campaign failed: ${data.error}`);
    };

    // Listen for bulk message started
    const handleBulkStarted = (data: any) => {
      console.log('Bulk message started:', data);
      setSendingProgress({
        sent: 0,
        total: data.totalGroups,
        currentGroup: ''
      });
      
      showInfo('Campaign Started', `Starting to send messages to ${data.totalGroups} groups...`);
    };

    // Listen for bulk message queued
    const handleBulkQueued = (data: any) => {
      console.log('Bulk message queued:', data);
      showInfo('Messages Queued', data.message || 'Messages have been queued for sending');
    };

    // Add event listeners
    socket.on('message-sent', handleMessageSent);
    socket.on('notification', handleNotification);
    socket.on('bulk-message-progress', handleBulkProgress);
    socket.on('bulk-message-completed', handleBulkCompleted);
    socket.on('bulk-message-error', handleBulkError);
    socket.on('bulk-message-started', handleBulkStarted);
    socket.on('bulk-message-queued', handleBulkQueued);

    return () => {
      socket.off('message-sent', handleMessageSent);
      socket.off('notification', handleNotification);
      socket.off('bulk-message-progress', handleBulkProgress);
      socket.off('bulk-message-completed', handleBulkCompleted);
      socket.off('bulk-message-error', handleBulkError);
      socket.off('bulk-message-started', handleBulkStarted);
      socket.off('bulk-message-queued', handleBulkQueued);
    };
  }, [socket, showSuccess, showError, showInfo, showWarning, addNotification]);

  const handleMediaUpload = (type: 'image' | 'video') => {
    // In a real app, this would handle file upload
    const url = prompt(`Enter ${type} URL:`);
    if (url) {
      setMediaUrl(url);
      setMediaType(type);
    }
  };

  const handleRemoveMedia = () => {
    setMediaUrl('');
    setMediaType(null);
  };

  const getAllSelectedGroupIds = () => {
    const allGroupIds: string[] = [];
    
    sessionSelectionInfo.forEach(sessionInfo => {
      sessionInfo.selectedGroups.forEach(group => {
        allGroupIds.push(group.id);
      });
    });
    
    return allGroupIds;
  };

  const handleSendCampaign = async () => {
    if (!message.trim()) {
      showWarning('Invalid Message', 'Please enter a message');
      return;
    }

    if (totalSelectedGroups === 0) {
      showWarning('No Groups Selected', 'Please select at least one group from the Groups tab');
      return;
    }

    if (!socket) {
      showError('Connection Error', 'Socket connection not available. Please refresh the page.');
      return;
    }

    if (sessionSelectionInfo.length === 0) {
      showError('No Connected Sessions', 'No connected WhatsApp sessions with selected groups');
      return;
    }

    const campaignData = {
      name: campaignName || `Campaign ${Date.now()}`,
      message,
      mediaUrl,
      mediaType,
      totalGroups: totalSelectedGroups,
      delay: delayBetweenMessages * 1000, // Convert to milliseconds
      isScheduled,
      scheduledAt: isScheduled ? new Date(`${scheduledDate} ${scheduledTime}`) : null,
      sessions: sessionSelectionInfo
    };

    console.log('Sending campaign:', campaignData);
    
    if (isScheduled) {
      // For scheduled campaigns, we'll just show a confirmation
      // In a real app, you'd store this in a database with a job scheduler
      showSuccess(
        'Campaign Scheduled', 
        `Campaign "${campaignData.name}" has been scheduled for ${scheduledDate} at ${scheduledTime}`
      );
      return;
    }

    // Show initial sending notification
    showInfo(
      'Starting Campaign', 
      `Sending messages to ${totalSelectedGroups} groups across ${sessionSelectionInfo.length} sessions...`
    );

    setIsSending(true);
    setCampaignResults([]);
    setSendingProgress({ sent: 0, total: totalSelectedGroups, currentGroup: '' });
    
    try {
      // Send messages to all sessions
      for (const sessionInfo of sessionSelectionInfo) {
        const groupIds = sessionInfo.selectedGroups.map(group => group.id);
        
        console.log(`Sending to session ${sessionInfo.sessionId} with ${groupIds.length} groups`);
        
        // Send bulk messages for this session
        socket.emit('send-bulk-messages', {
          sessionId: sessionInfo.sessionId,
          groupIds: groupIds,
          message: message,
          media: mediaUrl ? { path: mediaUrl, type: mediaType } : null,
          delay: delayBetweenMessages * 1000 // Convert to milliseconds
        });
      }

    } catch (error) {
      console.error('Error sending campaign:', error);
      setIsSending(false);
      showError('Campaign Error', 'Error sending campaign. Please try again.');
    }
  };

  const canSendCampaign = message.trim() && totalSelectedGroups > 0 && !isSending && socket;

  const progressPercentage = sendingProgress.total > 0 
    ? (sendingProgress.sent / sendingProgress.total) * 100 
    : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-2">Create Campaign</h2>
        <p className="text-gray-400">
          Send messages to selected groups across {connectedSessions.length} WhatsApp accounts
        </p>
      </div>

      {/* Campaign Progress (shown during sending) */}
      {isSending && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
            <h3 className="text-lg font-semibold text-white">Sending Campaign...</h3>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between text-sm text-gray-300">
              <span>Progress: {sendingProgress.sent}/{sendingProgress.total}</span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
            
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
            
            {sendingProgress.currentGroup && (
              <p className="text-sm text-gray-400">
                Currently sending to: {sendingProgress.currentGroup}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Campaign Results (shown after completion) */}
      {campaignResults.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Campaign Results</h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {campaignResults.map((result, index) => (
              <div key={index} className="flex items-center space-x-3 text-sm">
                {result.success ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                )}
                <span className={result.success ? 'text-green-300' : 'text-red-300'}>
                  Group {index + 1}: {result.success ? 'Sent' : `Failed - ${result.error}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign Settings */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Campaign Name
          </label>
          <input
            type="text"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Enter campaign name..."
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isSending}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Message *
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your promotional message here..."
            rows={6}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            disabled={isSending}
          />
          <div className="flex justify-between text-sm text-gray-400 mt-2">
            <span>{message.length} characters</span>
            <span>Recommended: Keep under 1000 characters</span>
          </div>
        </div>

        {/* Media Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Attach Media (Optional)
          </label>
          <div className="flex space-x-3">
            <button
              onClick={() => handleMediaUpload('image')}
              disabled={isSending}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Image className="h-5 w-5" />
              <span>Add Image</span>
            </button>
            <button
              onClick={() => handleMediaUpload('video')}
              disabled={isSending}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Video className="h-5 w-5" />
              <span>Add Video</span>
            </button>
          </div>
          
          {mediaUrl && (
            <div className="mt-3 p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center space-x-2">
                {mediaType === 'image' ? (
                  <Image className="h-5 w-5 text-green-400" />
                ) : (
                  <Video className="h-5 w-5 text-green-400" />
                )}
                <span className="text-sm text-gray-300 truncate flex-1">{mediaUrl}</span>
                <button
                  onClick={handleRemoveMedia}
                  disabled={isSending}
                  className="text-red-400 hover:text-red-300 text-sm px-2 py-1 rounded disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sending Settings */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-6">
        <div className="flex items-center space-x-3">
          <Settings className="h-6 w-6 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Sending Settings</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Delay Between Messages (seconds)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={delayBetweenMessages}
              onChange={(e) => setDelayBetweenMessages(parseInt(e.target.value) || 5)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSending}
            />
            <p className="text-xs text-gray-400 mt-1">
              Recommended: 5-10 seconds to avoid being blocked
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                disabled={isSending}
                className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-300">Schedule Campaign</span>
            </label>
            
            {isScheduled && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  disabled={isSending}
                  className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  disabled={isSending}
                  className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Groups Details */}
      {totalSelectedGroups > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <CheckCircle className="h-6 w-6 text-green-400" />
            <h3 className="text-lg font-semibold text-white">Selected Groups</h3>
          </div>
          
          <div className="space-y-4">
            {sessionSelectionInfo.map((sessionInfo) => (
              <div key={sessionInfo.sessionId} className="bg-gray-900 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <Smartphone className="h-5 w-5 text-blue-400" />
                    <span className="font-medium text-white">{sessionInfo.phoneNumber}</span>
                  </div>
                  <span className="text-sm text-gray-400">
                    {sessionInfo.selectedCount}/{sessionInfo.totalGroups} groups
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {sessionInfo.selectedGroups.slice(0, 6).map((group) => (
                    <div key={group.id} className="flex items-center space-x-2 text-sm">
                      <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                      <span className="text-gray-300 truncate">{group.name}</span>
                    </div>
                  ))}
                  {sessionInfo.selectedGroups.length > 6 && (
                    <div className="text-sm text-gray-400">
                      +{sessionInfo.selectedGroups.length - 6} more groups
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign Summary */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Campaign Summary</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Users className="h-6 w-6 text-blue-400" />
              <div>
                <p className="text-sm text-gray-400">Target Groups</p>
                <p className="text-xl font-bold text-white">{totalSelectedGroups}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Clock className="h-6 w-6 text-amber-400" />
              <div>
                <p className="text-sm text-gray-400">Estimated Time</p>
                <p className="text-xl font-bold text-white">
                  {Math.floor(estimatedTime / 60)}m {estimatedTime % 60}s
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Send className="h-6 w-6 text-green-400" />
              <div>
                <p className="text-sm text-gray-400">WhatsApp Accounts</p>
                <p className="text-xl font-bold text-white">{connectedSessions.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Connection Status Warning */}
        {!socket && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <div>
                <p className="font-medium text-red-400">No socket connection</p>
                <p className="text-sm text-red-300">
                  Please refresh the page to establish connection with the server.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Warning Messages */}
        {totalSelectedGroups === 0 && (
          <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <div>
                <p className="font-medium text-amber-400">No groups selected</p>
                <p className="text-sm text-amber-300">
                  Go to the Groups tab and select groups to send messages to.
                </p>
              </div>
            </div>
          </div>
        )}

        {!message.trim() && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <MessageSquare className="h-6 w-6 text-red-400" />
              <div>
                <p className="font-medium text-red-400">Message required</p>
                <p className="text-sm text-red-300">
                  Please enter a message to send to the selected groups.
                </p>
              </div>
            </div>
          </div>
        )}

        {isScheduled && (!scheduledDate || !scheduledTime) && (
          <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <Clock className="h-6 w-6 text-amber-400" />
              <div>
                <p className="font-medium text-amber-400">Schedule incomplete</p>
                <p className="text-sm text-amber-300">
                  Please set both date and time for scheduled campaign.
                </p>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleSendCampaign}
          disabled={!canSendCampaign || (isScheduled && (!scheduledDate || !scheduledTime))}
          className={`w-full flex items-center justify-center space-x-3 px-6 py-4 rounded-lg font-semibold text-white transition-colors ${
            canSendCampaign && (!isScheduled || (scheduledDate && scheduledTime))
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-600 cursor-not-allowed'
          }`}
        >
          {isSending ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              <span>Sending Campaign... ({sendingProgress.sent}/{sendingProgress.total})</span>
            </>
          ) : isScheduled ? (
            <>
              <Clock className="h-5 w-5" />
              <span>Schedule Campaign</span>
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              <span>Send Campaign Now</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CampaignComposer;