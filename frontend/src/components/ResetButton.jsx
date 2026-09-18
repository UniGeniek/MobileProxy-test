import React, { useState, useEffect, useRef } from 'react';

export default function ResetButton({ proxy, onReset }) {
  const [cooldown, setCooldown] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const remaining = proxy.rateLimit?.cooldownRemaining || 0;
    if (remaining > 0) {
      setCooldown(remaining);
    }
  }, [proxy.rateLimit?.cooldownRemaining]);

  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [cooldown]);

  const isDisabled = proxy.status === 'resetting' || cooldown > 0 || isPending;

  const handleClick = async () => {
    if (isDisabled) return;
    setIsPending(true);
    try {
      await onReset(proxy.port);
      setCooldown(60); // Start local cooldown
    } catch (err) {
      if (err.data?.retryIn) {
        setCooldown(err.data.retryIn);
      }
    } finally {
      setIsPending(false);
    }
  };

  const getLabel = () => {
    if (proxy.status === 'resetting' || isPending) return '⟳ Resetting...';
    if (cooldown > 0) return `⏱ ${cooldown}s`;
    return '↻ Reset';
  };

  return (
    <div className="reset-btn">
      <button
        className={`btn btn--sm ${proxy.status === 'resetting' ? 'btn--ghost' : 'btn--primary'}`}
        onClick={handleClick}
        disabled={isDisabled}
        title={cooldown > 0 ? `Available in ${cooldown}s` : 'Reset IP'}
      >
        {getLabel()}
      </button>
    </div>
  );
}
