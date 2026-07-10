import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane, faTimes, faEnvelope, faArrowLeft, faCheck, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { getPendingTransactionsCount } from "@/src/lib/offlineSync";

const BOT_NAME = "POS Assistant";

const QUICK_PROMPTS_LOGIN = [
  "How do I log in?",
  "I forgot my passcode",
  "Offline login not working",
  "How do I sync data?",
];

const QUICK_PROMPTS_POS = [
  "How do I process a sale?",
  "How do I refund a transaction?",
  "How do I close the till?",
  "How do I sync offline transactions?",
  "How do I print a receipt?",
  "How do I adjust float?",
  "How do I hold an order?",
  "How do I add a discount?",
];

const firstMessage = {
  role: "bot",
  text: "Hi! I\u2019m your POS Assistant. I can help with login, sales, till operations, refunds, printing, syncing, settings, and more. What do you need help with?",
};

const getBotReply = (question) => {
  const q = String(question || "").toLowerCase();

  if (q.includes("sync") || q.includes("offline") || q.includes("pending transaction")) {
    return {
      text: "To sync offline transactions:\n1. Make sure you\u2019re connected to the internet\n2. Open the Sidebar (hamburger menu)\n3. Click \u2018Sync Transactions\u2019\n\nTransactions saved while offline are queued automatically and sync when connection is restored.",
    };
  }

  if (q.includes("refund")) {
    return {
      text: "To process a refund:\n1. Go to ORDERS tab\n2. Select the COMPLETE sub-tab\n3. Find and click the transaction\n4. Click \u2018Refund\u2019 in the detail panel\n\nNote: Only senior staff and above can process refunds.",
    };
  }

  if (q.includes("print") && (q.includes("receipt") || q.includes("transaction"))) {
    return {
      text: "To print a receipt:\n\u2022 From cart: Click the PRINT button at the bottom of the cart panel\n\u2022 From orders: Go to ORDERS > COMPLETE, select a transaction, then click \u2018Print\u2019\n\u2022 Receipts auto-print after payment if thermal printer is configured\n\nConfigure printer in Settings > Printer Settings.",
    };
  }

  if (q.includes("print")) {
    return {
      text: "Printing options:\n\u2022 PRINT button in cart panel prints current order\n\u2022 After payment, receipt auto-prints if configured\n\u2022 Go to ORDERS > COMPLETE to reprint past receipts\n\u2022 Configure your thermal printer in Settings > Printer Settings",
    };
  }

  if (q.includes("login") || q.includes("log in") || q.includes("sign in")) {
    return {
      text: "To log in:\n1. Select your Store\n2. Select your Location from the dropdown\n3. Click your name in the Staff cards\n4. Enter your 4-digit passcode on the number pad\n5. Click LOGIN\n\nIf offline, cached data is used and PIN validation is skipped.",
    };
  }

  if (q.includes("passcode") || q.includes("pin") || q.includes("forgot")) {
    return {
      text: "Your passcode is a 4-digit number set by your admin. If you\u2019ve forgotten it, ask your manager or admin to reset it. In offline mode, PIN validation is skipped if data was previously synced.",
    };
  }

  if (q.includes("scale") || q.includes("zoom") || q.includes("size") || q.includes("too small") || q.includes("too big")) {
    return {
      text: "To adjust content size:\n1. Go to Settings\n2. Find \u2018Content Scale\u2019 section\n3. Use the slider or +/- buttons (60% to 150%)\n4. Click \u2018Save Settings\u2019\n\nThis scales the entire UI to fit screens where resolution can\u2019t be changed.",
    };
  }

  if (q.includes("open till") || q.includes("till open")) {
    return {
      text: "To open a till:\n\u2022 When you log in, if no till is open you\u2019ll be prompted to open one\n\u2022 Enter the opening cash balance (float amount)\n\u2022 Click \u2018Open Till\u2019 to start your session\n\nYou must have an open till before processing any sales.",
    };
  }

  if (q.includes("close till") || q.includes("till close") || q.includes("end of day")) {
    return {
      text: "To close your till:\n1. Open the Sidebar (hamburger menu)\n2. Click Admin > Close Till\n3. Count your physical cash for each tender type\n4. Enter the amounts in the reconciliation form\n5. Add any notes and click \u2018Close Till\u2019\n\nThe system will calculate variance between expected and actual amounts.",
    };
  }

  if (q.includes("till")) {
    return {
      text: "Till operations:\n\u2022 Open Till: Required before taking payments\n\u2022 Close Till: Sidebar > Admin > Close Till\n\u2022 Adjust Float: Sidebar > Admin > Adjust Float\n\u2022 Your till session tracks all transactions and tender breakdowns.",
    };
  }

  if (q.includes("payment") || q.includes("sale") || q.includes("sell") || q.includes("process")) {
    return {
      text: "To process a sale:\n1. Tap products from the menu to add them to the cart\n2. Adjust quantities using +/- buttons\n3. Click PAY button at the bottom of the cart\n4. Select payment method\n5. Enter amount paid and confirm\n\nThe receipt will print automatically if configured.",
    };
  }

  if (q.includes("hold")) {
    return {
      text: "To hold an order:\n1. Add items to the cart as usual\n2. Click the HOLD button (blue) at the bottom\n3. The order is saved and the cart is cleared\n\nTo resume: Go to ORDERS tab > HELD sub-tab, then click the held order.",
    };
  }

  if (q.includes("discount") || q.includes("promo")) {
    return {
      text: "To apply a discount:\n\u2022 Per item: Click the item in the cart, then tap \u2018DISC\u2019 button\n\u2022 Customer promotion: Select a customer from CUSTOMERS tab who has an active promotion\n\u2022 Promotions are applied automatically based on customer type and product category.",
    };
  }

  if (q.includes("float") || q.includes("adjust")) {
    return {
      text: "To adjust float:\n1. Open the Sidebar\n2. Click Admin > Adjust Float\n3. Enter the amount and reason\n4. This updates your till\u2019s running balance\n\nFloat adjustments are tracked for end-of-day reconciliation.",
    };
  }

  if (q.includes("petty cash")) {
    return {
      text: "Petty cash withdrawals:\n\u2022 Use the PETTY CASH button in the cart panel\n\u2022 Enter the amount and reason for the withdrawal\n\u2022 This records the cash out and adjusts the till balance",
    };
  }

  if (q.includes("customer")) {
    return {
      text: "Customer features:\n\u2022 Go to the CUSTOMERS tab to browse or search customers\n\u2022 Select a customer to link them to the current transaction\n\u2022 Customers with active promotions get automatic discounts\n\u2022 Customer types: Regular, VIP, New, Bulk Buyer, etc.",
    };
  }

  if (q.includes("order") && (q.includes("history") || q.includes("past") || q.includes("previous"))) {
    return {
      text: "To view order history:\n1. Go to the ORDERS tab\n2. Use the sub-tabs: HELD, ORDERED, PENDING, COMPLETE\n3. COMPLETE shows today\u2019s completed transactions\n4. Click any order to see details, print, or refund.",
    };
  }

  if (q.includes("setting")) {
    return {
      text: "Settings options:\n\u2022 Sidebar sections: Show/hide Print, Stock, Apps menus\n\u2022 Till controls: Enable/disable cash entry and float adjustment\n\u2022 Layout: Adjust sidebar, cart panel, content density\n\u2022 Cart panel buttons: Control which action buttons are visible\n\u2022 Content scale: Scale the UI for different screen sizes\n\u2022 Printer: Configure thermal printer (USB or Network)",
    };
  }

  if (q.includes("printer") || q.includes("thermal")) {
    return {
      text: "Printer setup:\n1. Go to Settings > Open Printer Settings\n2. Enable thermal printer\n3. Choose connection: USB or Network\n4. For network: Enter printer IP and port (default 9100)\n5. Click \u2018Test Connection\u2019 to verify\n\nThe printer icon in the sidebar shows connection status.",
    };
  }

  if (q.includes("sidebar") || q.includes("menu")) {
    return {
      text: "The sidebar provides:\n\u2022 Admin: Adjust Float, Close Till\n\u2022 Print: Print current/previous/gift receipts\n\u2022 Stock: Stock count and movement\n\u2022 Settings & Support links\n\u2022 Cloud sync status\n\nToggle it with the hamburger icon on the top bar.",
    };
  }

  if (q.includes("connection") || q.includes("internet") || q.includes("network")) {
    return {
      text: "The system works offline:\n\u2022 Products and categories are cached locally\n\u2022 Transactions sync when online\n\u2022 Login works offline with cached credentials\n\u2022 Manual sync available in sidebar when back online.",
    };
  }

  return {
    text: "I can help with:\n\u2022 Login & authentication\n\u2022 Processing sales & payments\n\u2022 Till open / close / adjust float\n\u2022 Refunds & order history\n\u2022 Printing receipts\n\u2022 Offline sync\n\u2022 Settings & printer setup\n\u2022 Discounts & promotions\n\u2022 Customer management\n\nJust ask me about any of these topics!",
  };
};

export default function HelpChatBot() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([firstMessage]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [userEngaged, setUserEngaged] = useState(false);
  const idleTimerRef = useRef(null);
  const buttonTimerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const [emailSending, setEmailSending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Auto-hide idle timeout durations (ms)
  const CHAT_IDLE_MS = 15000;   // Close chat after 15s of no interaction
  const BUTTON_IDLE_MS = 8000;  // Hide floating button after 8s if chat not opened

  // Clear all idle timers
  const clearIdleTimers = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (buttonTimerRef.current) { clearTimeout(buttonTimerRef.current); buttonTimerRef.current = null; }
  }, []);

  // Start/reset the chat idle timer (auto-close chat when idle)
  // Only auto-close if user has NOT engaged (sent a message)
  const resetChatIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    // If the user has engaged in conversation, don't auto-close
    if (userEngaged) return;
    idleTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      // After closing, show button briefly then hide
      buttonTimerRef.current = setTimeout(() => {
        setShowButton(false);
      }, BUTTON_IDLE_MS);
    }, CHAT_IDLE_MS);
  }, [CHAT_IDLE_MS, BUTTON_IDLE_MS, userEngaged]);

  // Start button idle timer (hide button if chat not opened)
  const startButtonIdleTimer = useCallback(() => {
    if (buttonTimerRef.current) clearTimeout(buttonTimerRef.current);
    buttonTimerRef.current = setTimeout(() => {
      setShowButton((prev) => {
        // Only hide if chat is not open
        return false;
      });
    }, BUTTON_IDLE_MS);
  }, [BUTTON_IDLE_MS]);

  // When chat opens, start idle timer; when it closes, start button timer
  useEffect(() => {
    if (isOpen) {
      if (buttonTimerRef.current) clearTimeout(buttonTimerRef.current);
      resetChatIdleTimer();
    } else if (showButton) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      startButtonIdleTimer();
    }
    return () => clearIdleTimers();
  }, [isOpen, showButton, resetChatIdleTimer, startButtonIdleTimer, clearIdleTimers]);

  useEffect(() => {
    const checkLoginState = () => {
      try {
        const staffData = localStorage.getItem("staff");
        setIsLoggedIn(!!staffData);
      } catch {
        setIsLoggedIn(false);
      }
    };
    checkLoginState();
    window.addEventListener("storage", checkLoginState);
    return () => window.removeEventListener("storage", checkLoginState);
  }, []);

  const openWithTopic = useCallback((topic) => {
    setShowButton(true);
    setIsOpen(true);
    if (!topic) return;
    const topicPrompt = `Help: ${topic}`;
    setMessages((prev) => {
      if (prev.some((m) => m.text === topicPrompt)) return prev;
      return [...prev, { role: "user", text: topicPrompt }, { role: "bot", text: getBotReply(topicPrompt).text }];
    });
  }, []);

  useEffect(() => {
    const onHelpOpen = (event) => {
      openWithTopic(event?.detail?.topic || "");
    };
    window.addEventListener("help:open", onHelpOpen);
    return () => window.removeEventListener("help:open", onHelpOpen);
  }, [openWithTopic]);

  const sendMessage = useCallback((rawText) => {
    const text = String(rawText || "").trim();
    if (!text) return;
    const reply = getBotReply(text);
    setMessages((prev) => [...prev, { role: "user", text }, { role: "bot", text: reply.text }]);
    setInput("");
    // Mark user as engaged so chat won't auto-close
    setUserEngaged(true);
    // Reset idle timer on interaction (won't auto-close since engaged)
    resetChatIdleTimer();
  }, [resetChatIdleTimer]);

  // Load pending transaction count on mount / when chat opens
  useEffect(() => {
    if (!isOpen) return;
    getPendingTransactionsCount().then(c => setPendingCount(c)).catch(() => {});
  }, [isOpen]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const quickPrompts = useMemo(() => isLoggedIn ? QUICK_PROMPTS_POS : QUICK_PROMPTS_LOGIN, [isLoggedIn]);

  // Get store and staff info for email subject
  const getEmailContext = useCallback(() => {
    try {
      const staffRaw = localStorage.getItem("staff");
      const locationRaw = localStorage.getItem("location");
      const storeRaw = localStorage.getItem("cachedStore");
      const staff = staffRaw ? JSON.parse(staffRaw) : null;
      const location = locationRaw ? JSON.parse(locationRaw) : null;
      const store = storeRaw ? JSON.parse(storeRaw) : null;
      return {
        storeName: store?.name || "Unknown Store",
        locationName: location?.name || staff?.locationName || "Unknown Location",
        staffName: staff?.name || "Unknown Staff",
      };
    } catch {
      return { storeName: "Unknown Store", locationName: "Unknown Location", staffName: "Unknown Staff" };
    }
  }, []);

  const handleSendEmail = useCallback(async () => {
    const msg = emailMessage.trim();
    if (!msg) return;
    const ctx = getEmailContext();

    setEmailSending(true);
    try {
      const response = await fetch('/api/support/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          storeName: ctx.storeName,
          locationName: ctx.locationName,
          staffName: ctx.staffName,
        }),
      });

      if (response.ok) {
        setEmailSent(true);
        setMessages((prev) => [
          ...prev,
          { role: "user", text: `[Email Support] ${msg}` },
          { role: "bot", text: "Your support email has been sent successfully! We'll get back to you soon." },
        ]);
        setTimeout(() => {
          setShowEmailForm(false);
          setEmailMessage("");
          setEmailSent(false);
        }, 2000);
      } else {
        // Fallback to mailto if API fails
        const subject = encodeURIComponent(`Support - ${ctx.storeName} | ${ctx.locationName} | ${ctx.staffName}`);
        const body = encodeURIComponent(
          `${msg}\n\n---\nSent from POS Support Chat\nStore: ${ctx.storeName}\nLocation: ${ctx.locationName}\nStaff: ${ctx.staffName}\nDate: ${new Date().toLocaleString()}`
        );
        window.open(`mailto:hello.ayoola@gmail.com?subject=${subject}&body=${body}`, "_blank");
        setEmailSent(true);
        setMessages((prev) => [
          ...prev,
          { role: "user", text: `[Email Support] ${msg}` },
          { role: "bot", text: "Your email client has been opened with your support message. Please click Send in your email app to deliver it." },
        ]);
        setTimeout(() => {
          setShowEmailForm(false);
          setEmailMessage("");
          setEmailSent(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Email send error:', error);
      // Fallback to mailto
      const subject = encodeURIComponent(`Support - ${ctx.storeName} | ${ctx.locationName} | ${ctx.staffName}`);
      const body = encodeURIComponent(
        `${msg}\n\n---\nSent from POS Support Chat\nStore: ${ctx.storeName}\nLocation: ${ctx.locationName}\nStaff: ${ctx.staffName}\nDate: ${new Date().toLocaleString()}`
      );
      window.open(`mailto:hello.ayoola@gmail.com?subject=${subject}&body=${body}`, "_blank");
      setEmailSent(true);
      setTimeout(() => {
        setShowEmailForm(false);
        setEmailMessage("");
        setEmailSent(false);
      }, 2000);
    } finally {
      setEmailSending(false);
    }
    resetChatIdleTimer();
  }, [emailMessage, getEmailContext, resetChatIdleTimer]);

  if (!showButton && !isOpen) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-[80] w-14 h-14 rounded-full bg-cyan-700 hover:bg-cyan-600 shadow-xl border-2 border-cyan-400 transition-all hover:scale-110 flex items-center justify-center"
        aria-label="Open help assistant"
        title="POS Assistant"
      >
        <Image
          src="/images/bot-icon.ico"
          alt="POS Assistant"
          width={36}
          height={36}
          className="rounded-full object-contain"
          unoptimized
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-[92vw] max-w-sm rounded-xl border border-cyan-200 bg-white shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-cyan-700 text-white">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Image
            src="/images/bot-icon.ico"
            alt="Bot"
            width={24}
            height={24}
            className="rounded-full object-contain"
            unoptimized
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          {BOT_NAME}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('unsyncedData:open'));
            }}
            className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 ${pendingCount > 0 ? 'bg-amber-500 hover:bg-amber-400' : 'bg-cyan-600 hover:bg-cyan-500'}`}
            title="View unsynced data"
          >
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-3 h-3" />
            Unsynced{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => { setShowEmailForm(!showEmailForm); setEmailSent(false); }}
            className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 ${showEmailForm ? 'bg-amber-500 hover:bg-amber-400' : 'bg-cyan-600 hover:bg-cyan-500'}`}
            title="Send support email"
          >
            <FontAwesomeIcon icon={faEnvelope} className="w-3 h-3" />
            Email
          </button>
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="text-[11px] bg-cyan-600 hover:bg-cyan-500 px-2 py-1 rounded"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => { setIsOpen(false); setUserEngaged(false); }}
            className="w-7 h-7 rounded hover:bg-white/20 flex items-center justify-center"
            aria-label="Close help"
          >
            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-slate-50">
        {messages.map((msg, index) => (
          <div
            key={`${msg.role}-${index}`}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === "user"
                ? "bg-cyan-600 text-white ml-6"
                : "bg-white border border-slate-200 text-slate-700 mr-6"
            }`}
          >
            {msg.role === "bot" && (
              <div className="flex items-center gap-1.5 mb-1">
                <Image
                  src="/images/bot-icon.ico"
                  alt=""
                  width={16}
                  height={16}
                  className="rounded-full object-contain"
                  unoptimized
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <span className="text-[10px] font-bold text-cyan-700">{BOT_NAME}</span>
              </div>
            )}
            <div className="whitespace-pre-line">{msg.text}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200 p-2 bg-white">
        {showEmailForm ? (
          /* Email Compose Form */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEmailForm(false)}
                className="p-1 hover:bg-slate-100 rounded"
              >
                <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3 text-slate-500" />
              </button>
              <div className="flex-1">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faEnvelope} className="w-3 h-3 text-amber-500" />
                  Send Support Email
                </p>
                <p className="text-[10px] text-slate-500">To: hello.ayoola@gmail.com</p>
              </div>
            </div>
            {emailSent ? (
              <div className="flex items-center justify-center gap-2 py-3 text-green-600">
                <FontAwesomeIcon icon={faCheck} className="w-4 h-4" />
                <span className="text-sm font-semibold">Email sent!</span>
              </div>
            ) : (
              <>
                <textarea
                  value={emailMessage}
                  onChange={(e) => { setEmailMessage(e.target.value); resetChatIdleTimer(); }}
                  placeholder="Describe your issue or question..."
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none"
                />
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={!emailMessage.trim() || emailSending}
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <FontAwesomeIcon icon={faPaperPlane} className="w-3.5 h-3.5" />
                  {emailSending ? 'Sending...' : 'Send Support Email'}
                </button>
              </>
            )}
          </div>
        ) : (
          /* Normal Chat Input */
          <>
            <div className="flex flex-wrap gap-1 mb-2">
              {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="text-[11px] px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); resetChatIdleTimer(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage(input);
            }}
            placeholder="Ask for help..."
            className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200"
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded"
            aria-label="Send help message"
          >
            <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
