import { ArrowUp, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { locale, t } from '../i18n';

interface ComposerProps {
  text: string;
  setText: (t: string) => void;
  error: string | null;
  onSend: (t: string) => void;
  disabled?: boolean;
}

export function Composer({ text, setText, error, onSend, disabled }: ComposerProps) {
  // Chromium's speech service needs Google API keys that Electron doesn't ship, so dictation stays browser-only.
  const shell = document.documentElement.dataset.shell;
  const SpeechRecognition: any =
    shell === 'mac' || shell === 'desktop' ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const recognizer = useRef<any>(null);

  useEffect(() => {
    if (text) input.current?.focus();
  }, [text === '']);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const toggleVoice = () => {
    if (listening) return recognizer.current?.stop();
    const r = new SpeechRecognition();
    r.interimResults = true;
    r.lang = locale() ?? navigator.language;
    const base = text ? `${text} ` : '';
    r.onresult = (e: any) => setText(base + Array.from(e.results, (x: any) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    recognizer.current = r;
    setListening(true);
    r.start();
  };

  if (disabled) return null;

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-box">
        <label htmlFor="composer-input" className="sr-only">
          {t('Message Duet')}
        </label>
        <textarea
          id="composer-input"
          ref={input}
          rows={1}
          value={text}
          placeholder={t('Hand Duet a task, or ask anything')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
          }}
        />
        <div className="composer-tools">
          {SpeechRecognition && (
            <button
              type="button"
              className={`icon-btn mic ${listening ? 'is-on' : ''}`}
              onClick={toggleVoice}
              aria-pressed={listening}
              aria-label={listening ? t('Stop dictation') : t('Dictate a message')}
              title={listening ? t('Stop dictation') : t('Dictate')}
            >
              {listening ? <Square size={16} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
          )}
          <button type="submit" className="send" disabled={!text.trim()} aria-label={t('Send')}>
            <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className={`composer-note ${error ? 'is-error' : ''}`} role={error ? 'alert' : undefined}>
        {error ?? t('Enter to send. Shift+Enter for a new line.')}
      </p>
    </form>
  );
}
