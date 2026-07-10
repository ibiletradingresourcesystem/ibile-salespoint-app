/**
 * ReceiptPrinter Component
 * 
 * Generates and prints transaction receipts with:
 * - Company branding (logo, name, contact info)
 * - Transaction details (date, staff, items, totals)
 * - Payment breakdown by tender
 * - Thank you message with company info
 * - Optimized for thermal receipt printer (58mm width)
 * 
 * Usage:
 * <ReceiptPrinter 
 *   transaction={transaction}
 *   receiptSettings={receiptSettings}
 *   onPrint={() => {}}
 * />
 */

/* eslint-disable @next/next/no-img-element */
import React, { useRef, useEffect } from 'react';
import Image from 'next/image';
import {
  buildReceiptViewModel,
  formatReceiptNaira,
} from '../../lib/receiptViewModel';

export default function ReceiptPrinter({ 
  transaction, 
  receiptSettings = {},
  onPrint = () => {},
  isVisible = true 
}) {
  const receiptRef = useRef(null);
  
  // Compute font settings from receiptSettings
  const receiptFontFamily = (receiptSettings?.fontFamily || 'Arial').trim();
  const receiptFontSize = Number(receiptSettings?.fontSize) || 6.5;

  // Font family mapping for receipt
  const FONT_FAMILY_MAP = {
    'Arial': "'Arial', 'Helvetica Neue', sans-serif",
    'Courier New': "'Courier New', 'Courier', monospace",
    'Times New Roman': "'Times New Roman', 'Times', serif",
    'Verdana': "'Verdana', 'Geneva', sans-serif",
    'Georgia': "'Georgia', 'Cambria', serif",
    'Tahoma': "'Tahoma', 'Geneva', sans-serif",
    'Roboto': "'Roboto', 'Arial', sans-serif",
    'Mono': "'Courier New', 'Lucida Console', monospace",
  };
  const resolvedFontFamily = FONT_FAMILY_MAP[receiptFontFamily] || FONT_FAMILY_MAP['Arial'];

  // Handle print
  const handlePrint = () => {
    if (receiptRef.current) {
      const printWindow = window.open('', '_blank');
      const receiptHTML = receiptRef.current.innerHTML;
      
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Transaction Receipt</title>
            <style>
	              html, body {
	                margin: 0;
	                padding: 0;
	                background: white;
	              }

	              body {
	                font-family: ${resolvedFontFamily};
	              }

	              .receipt-page {
	                width: 58mm;
	                min-width: 58mm;
	                max-width: 58mm;
	                margin: 0 auto;
	                padding: 0;
	                background: white;
	                display: flex;
	                justify-content: center;
	              }
	              
	              .receipt {
	                width: 100%;
                padding: 1mm 0;
                font-size: ${receiptFontSize}pt;
                line-height: 1.15;
                color: #000;
              }
              
              .receipt-header {
                text-align: center;
                margin-bottom: 1.5mm;
                padding-bottom: 1.5mm;
                border-bottom: 1px dashed #000;
              }
              
              .receipt-header img {
                max-width: 30mm;
                max-height: 12mm;
                margin-bottom: 1mm;
                filter: grayscale(100%);
              }
              
              .company-name {
                font-weight: bold;
                font-size: ${receiptFontSize + 1.5}pt;
                margin: 0.5mm 0;
                letter-spacing: 0.3px;
              }
              
              .company-info {
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                line-height: 1.15;
                color: #333;
              }
              
              .separator {
                border: none;
                border-top: 1px dashed #000;
                margin: 1mm 0;
                font-size: 0;
                line-height: 0;
                height: 0;
                overflow: hidden;
              }
              
              .receipt-details {
                text-align: left;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                margin: 1mm 0;
              }
              
              .detail-row {
                display: flex;
                justify-content: space-between;
                margin: 0.2mm 0;
              }
              
              .items-section {
                margin: 1mm 0;
                border-top: 1px dashed #000;
                border-bottom: 1px dashed #000;
                padding: 1mm 0;
              }
              
              .items-header {
                display: grid;
                grid-template-columns: 2.4fr 1fr 0.5fr 1fr;
                gap: 0;
                font-weight: bold;
                margin-bottom: 0.5mm;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                text-transform: uppercase;
              }
              
              .item-row {
                display: grid;
                grid-template-columns: 2.4fr 1fr 0.5fr 1fr;
                gap: 0;
                margin: 0;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
              }
              
              .item-name {
                text-align: left;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              
              .item-rate {
                text-align: right;
              }

              .item-qty {
                text-align: center;
              }
              
              .item-total {
                text-align: right;
              }
              
              .totals-section {
                margin: 1mm 0;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
              }
              
              .total-row {
                display: flex;
                justify-content: space-between;
                margin: 0.2mm 0;
              }
              
              .final-total {
                font-weight: bold;
                font-size: ${receiptFontSize + 1}pt;
                border-top: 1px dashed #000;
                padding-top: 0.8mm;
                margin: 0.8mm 0;
              }
              
              .payment-section {
                margin: 1mm 0;
                border-top: 1px dashed #000;
                border-bottom: 1px dashed #000;
                padding: 1mm 0;
              }
              
              .payment-title {
                font-weight: bold;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                margin-bottom: 0.3mm;
              }
              
              .payment-row {
                display: flex;
                justify-content: space-between;
                margin: 0.2mm 0;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
              }
              
              .qr-section {
                text-align: center;
                margin: 1mm 0;
                padding: 1mm 0;
                border-top: 1px dashed #000;
              }
              
              .qr-box {
                background: #f0f0f0;
                width: 18mm;
                height: 18mm;
                margin: 0.5mm auto;
                border: 1px solid #000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${Math.max(5, receiptFontSize - 1)}pt;
                color: #666;
              }
              
              .qr-description {
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                margin: 0.5mm 0;
                font-weight: bold;
              }
              
              .message-section {
                text-align: center;
                margin: 1mm 0;
                padding: 1mm 0;
                border-top: 1px dashed #000;
                font-size: ${receiptFontSize}pt;
                white-space: pre-wrap;
              }
              
              .thank-you {
                text-align: center;
                font-weight: bold;
                font-size: ${receiptFontSize + 1}pt;
                margin: 2mm 0;
              }
              
              .footer {
                text-align: center;
                font-size: ${Math.max(4, receiptFontSize - 0.5)}pt;
                margin-top: 3mm;
                color: #666;
              }
              
              .status-box {
                text-align: center;
                font-weight: bold;
                font-size: ${receiptFontSize + 1}pt;
                border: 2px solid #000;
                padding: 1.5mm;
                margin: 2mm 0;
              }
              
              @media print {
	                html, body {
	                  margin: 0 !important;
	                  padding: 0 !important;
	                  background: white;
	                }
	                .receipt-page {
	                  width: 58mm;
	                  min-width: 58mm;
	                  max-width: 58mm;
	                  margin: 0 auto !important;
	                  padding: 0 !important;
	                }
	                .receipt {
	                  margin: 0;
	                  padding: 0;
	                }
	              }
	            </style>
          </head>
	          <body>
	            <div class="receipt-page">${receiptHTML}</div>
	          </body>
        </html>
      `);
      
      printWindow.document.close();
      
      // Wait for content to load before printing
      setTimeout(() => {
        printWindow.print();
        onPrint();
      }, 250);
    }
  };

  if (!transaction || !isVisible) return null;

  const model = buildReceiptViewModel(transaction, receiptSettings);

  // Ensure logo is an absolute URL for printing contexts
  const companyLogo = model.companyLogo && model.companyLogo !== '/images/placeholder.jpg'
    ? model.companyLogo
    : '';

  return (
    <div>
      {/* Hidden Receipt Template for Printing */}
      <div 
        ref={receiptRef} 
        className="receipt"
        style={{ display: 'none' }}
      >
        <div className="receipt-header">
          {/* Company Logo */}
          {companyLogo && (
            <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
              <Image
                src={companyLogo}
                alt="Company Logo"
                width={160}
                height={80}
                style={{
                  maxWidth: '40mm',
                  maxHeight: '20mm',
                  filter: 'grayscale(100%)',
                  width: 'auto',
                  height: 'auto',
                }}
              />
            </div>
          )}

          {/* Company Name */}
          <div className="company-name">
            {model.companyName}
          </div>

          {/* Store Info */}
          <div className="company-info">
            {model.locationName && <div>{model.locationName}</div>}
            {model.address && <div>{model.address}</div>}
            {model.contactLine && <div>{model.contactLine}</div>}
            {model.taxNumber && <div>Tax ID: {model.taxNumber}</div>}
          </div>
        </div>

        {/* Receipt Details */}
        <div className="receipt-details">
          <div style={{ fontWeight: 'bold', marginBottom: '2mm' }}>
            {model.title}
          </div>
          
          <div className="detail-row">
            <span>{model.dateTime}</span>
            <span style={{ textAlign: 'right' }}>{model.receiptId}</span>
          </div>
          
	          <div className="detail-row">
	            <span>Staff: {model.staffName}</span>
	            <span style={{ textAlign: 'right' }}>{model.status}</span>
	          </div>

	          {model.directorMemoAccount?.active && (
	            <div className="detail-row">
	              <span>Director</span>
	              <span style={{ textAlign: 'right' }}>{model.directorMemoAccount.name}</span>
	            </div>
	          )}
	        </div>

        {/* Separator */}
        <div className="separator">━━━━━━━━━━━━━━━━━━</div>

        {/* Items Section */}
        <div className="items-section">
          <div className="items-header">
            <span>ITEM</span>
            <span style={{ textAlign: 'right' }}>RATE</span>
            <span style={{ textAlign: 'center' }}>QTY</span>
            <span style={{ textAlign: 'right' }}>TOTAL</span>
          </div>

          {/* Items */}
          {model.items.map((item, idx) => (
            <div key={idx} className="item-row">
              <div className="item-name">{item.name}</div>
              <div className="item-rate">{formatReceiptNaira(item.unitPrice)}</div>
              <div className="item-qty">{item.quantity}</div>
              <div className="item-total">
                {formatReceiptNaira(item.lineTotal)}
              </div>
            </div>
          ))}

          {/* Total Qty */}
          <div className="detail-row" style={{ marginTop: '2mm', paddingTop: '1.5mm', borderTop: '1px dashed #000' }}>
            <span>Total Qty</span>
            <span style={{ fontWeight: 'bold', textAlign: 'right' }}>
              {model.totalQuantity}
            </span>
          </div>
        </div>

        {/* Separator */}
        <div className="separator">━━━━━━━━━━━━━━━━━━</div>

        {/* Totals */}
        <div className="totals-section">
          <div className="total-row">
            <span>Subtotal:</span>
            <span style={{ textAlign: 'right' }}>{formatReceiptNaira(model.subtotal)}</span>
          </div>
          
          {model.tax > 0 && (
            <div className="total-row">
              <span>Tax:</span>
              <span style={{ textAlign: 'right' }}>{formatReceiptNaira(model.tax)}</span>
            </div>
          )}

          {model.adjustmentLines.map((line, idx) => (
            <div key={`${line.label}-${idx}`} className="total-row">
              <span>{line.label}:</span>
              <span style={{ textAlign: 'right' }}>{line.type === 'subtract' ? '-' : ''}{formatReceiptNaira(line.amount)}</span>
            </div>
          ))}

          <div className="final-total">
            <div className="total-row">
              <span>TOTAL:</span>
              <span style={{ textAlign: 'right' }}>{formatReceiptNaira(model.total)}</span>
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="separator">━━━━━━━━━━━━━━━━━━</div>

        {/* Payment Section */}
        <div className="payment-section">
          <div className="payment-title">PAYMENT BY TENDER</div>
          
          {model.tenderPayments.map((payment, idx) => (
              <div key={idx} className="payment-row">
                <span>{payment.name}</span>
                <span style={{ textAlign: 'right' }}>
                  {formatReceiptNaira(payment.amount)}
                </span>
              </div>
            ))}
        </div>

        {/* Change (if applicable) */}
        {model.change > 0 && (
          <>
            <div className="separator">━━━━━━━━━━━━━━━━━━</div>
            <div className="detail-row">
              <span style={{ fontWeight: 'bold' }}>CHANGE:</span>
              <span style={{ textAlign: 'right', fontWeight: 'bold' }}>
                {formatReceiptNaira(model.change)}
              </span>
            </div>
          </>
        )}

        {/* QR Code */}
        {(model.qrImageSrc || model.qrUrl) && (
          <div className="qr-section">
            {model.qrDescription && <div className="qr-description">{model.qrDescription}</div>}
            {model.qrImageSrc ? (
              <img src={model.qrImageSrc} alt="QR Code" className="qr-box" />
            ) : (
              <div className="qr-description">{model.qrUrl}</div>
            )}
          </div>
        )}

        {/* Message */}
        {model.receiptMessage && (
          <div className="message-section">
            {model.receiptMessage}
          </div>
        )}

        {/* Additional Info */}
        {model.refundDays > 0 && (
          <div style={{ textAlign: 'center', fontSize: '8pt', marginTop: '3mm' }}>
            Refund within {model.refundDays} days with receipt
          </div>
        )}

        {/* Status */}
        <div className="status-box">
          {model.status}
        </div>
      </div>

      {/* Print Button (visible during development, remove for production) */}
      <button
        onClick={handlePrint}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '10px 20px',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          zIndex: 1000,
          fontSize: '14px',
          fontWeight: 'bold',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        title="Click to print receipt"
      >
        🖨️ Print Receipt
      </button>
    </div>
  );
}
