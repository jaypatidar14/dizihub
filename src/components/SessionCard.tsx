import React from 'react';
import { 
  Smartphone, 
  Wifi, 
  WifiOff, 
  Users, 
  AlertCircle, 
  CheckCircle, 
  Clock,
  Trash2
} from 'lucide-react';
import { WhatsAppSession, useCampaign } from '../contexts/CampaignContext';
import QRCodeDisplay from './QRCodeDisplay';

interface SessionCardProps {
  session: WhatsAppSession;
}

const SessionCard: React.FC<SessionCardProps> = ({ session }) => {
  const { disconnectSession } = useCampaign();

  const getStatusIcon = () => {
    switch (session.status) {
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'waiting_for_scan':
        return <Clock className="h-5 w-5 text-amber-400" />;
      case 'initializing':
        return <Clock className="h-5 w-5 text-blue-400 animate-pulse" />;
      case 'auth_failure':
        return <AlertCircle className="h-5 w-5 text-red-400" />;
      default:
        return <WifiOff className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (session.status) {
      case 'connected':
        return 'Connected';
      case 'waiting_for_scan':
        return 'Waiting for QR scan';
      case 'initializing':
        return 'Initializing...';
      case 'auth_failure':
        return 'Authentication failed';
      default:
        return 'Disconnected';
    }
  };

  const getStatusColor = () => {
    switch (session.status) {
      case 'connected':
        return 'text-green-400';
      case 'waiting_for_scan':
        return 'text-amber-400';
      case 'initializing':
        return 'text-blue-400';
      case 'auth_failure':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const selectedGroups = session.groups.filter(g => g.isSelected).length;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Smartphone className="h-6 w-6 text-blue-400" />
          <div>
            <h3 className="font-semibold text-white">
              {session.phoneNumber || session.id.replace('session_', 'Account ')}
            </h3>
            <div className={`flex items-center space-x-2 text-sm ${getStatusColor()}`}>
              {getStatusIcon()}
              <span>{getStatusText()}</span>
            </div>
          </div>
        </div>
        
        <button
          onClick={() => disconnectSession(session.id)}
          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
          title="Disconnect session"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* QR Code or Connection Info */}
      {session.status === 'waiting_for_scan' && session.qrCode ? (
        <QRCodeDisplay qrCode={session.qrCode} />
      ) : session.status === 'connected' ? (
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center space-x-3">
              <Users className="h-5 w-5 text-blue-400" />
              <div>
                <p className="text-sm text-gray-400">Total Groups</p>
                <p className="font-semibold">{session.groups.length}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <div>
                <p className="text-sm text-gray-400">Selected</p>
                <p className="font-semibold">{selectedGroups}</p>
              </div>
            </div>
          </div>
          
          {session.phoneNumber && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400">Phone Number</p>
              <p className="font-mono text-green-400">+{session.phoneNumber}</p>
            </div>
          )}
        </div>
      ) : session.status === 'initializing' ? (
        <div className="bg-gray-900 rounded-lg p-6 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-gray-400">Setting up WhatsApp connection...</p>
        </div>
      ) : session.status === 'auth_failure' ? (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 font-medium">Authentication Failed</p>
          <p className="text-sm text-gray-400 mt-1">Please try connecting again</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-lg p-4 text-center">
          <WifiOff className="h-8 w-8 text-gray-500 mx-auto mb-2" />
          <p className="text-gray-400">Not connected</p>
        </div>
      )}

      {/* Last Activity */}
      {session.lastActivity && (
        <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
          Last activity: {session.lastActivity.toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default SessionCard;