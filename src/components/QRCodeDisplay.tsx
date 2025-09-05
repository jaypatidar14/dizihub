import React, { useState } from 'react';
import { QrCode, Download, RefreshCw } from 'lucide-react';

interface QRCodeDisplayProps {
  qrCode: string;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ qrCode }) => {
  console.log('🎨 QRCodeDisplay rendering with qrCode:', qrCode?.substring(0, 50) + '...');
  
  // Removed unused isLoading state

  const downloadQR = () => {
    const link = document.createElement('a');
    link.href = qrCode;
    link.download = `whatsapp-qr-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-xl p-6 text-center">
      <div className="mb-4">
        <QrCode className="h-8 w-8 text-gray-600 mx-auto mb-2" />
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Scan QR Code</h3>
        <p className="text-sm text-gray-600">
          Open WhatsApp on your phone and scan this QR code
        </p>
      </div>
      
      <div className="relative inline-block">
        <img
          src={qrCode}
          alt="WhatsApp QR Code"
          className="w-48 h-48 mx-auto border border-gray-200 rounded-lg"
        />
        
        // Removed unused loading spinner
      </div>
      
      <div className="mt-4 space-y-2">
        <button
          onClick={downloadQR}
          className="flex items-center space-x-2 mx-auto px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        >
          <Download className="h-4 w-4" />
          <span>Download QR</span>
        </button>
        
        <div className="text-xs text-gray-500 space-y-1">
          <p>1. Open WhatsApp on your phone</p>
          <p>2. Tap Menu → Settings → Linked Devices</p>
          <p>3. Tap "Link a device" and scan this code</p>
        </div>
      </div>
    </div>
  );
};

export default QRCodeDisplay;