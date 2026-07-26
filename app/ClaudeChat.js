'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';

const MODELS = ['Analüüs Deep', 'Analüüs Fast', 'Brief'];
const MOBILE_MQ = '(max-width: 720px)';

function uid(prefix = 'c') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function storageKey(userId, kind) {
  return `investor-ai-${kind}-v2:${userId}`;
}

function loadJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function emptyChat() {
  return { id: uid(), title: 'Uus vestlus', messages: [], updatedAt: Date.now(), pinned: false };
}

function rowToChat(row) {
  return {
    id: row.id,
    title: row.title || 'Uus vestlus',
    messages: Array.isArray(row.messages) ? row.messages : [],
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    pinned: Boolean(row.pinned),
  };
}

function chatToRow(chat, userId) {
  return {
    id: chat.id,
    user_id: userId,
    title: chat.title || 'Uus vestlus',
    messages: chat.messages || [],
    pinned: Boolean(chat.pinned),
    updated_at: new Date(chat.updatedAt || Date.now()).toISOString(),
  };
}

function titleFromMessages(messages) {
  const first = messages.find((m) => m.role === 'user');
  if (!first?.content) return 'Uus vestlus';
  const t = first.content.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

function renderText(text) {
  const decoded = String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const lines = decoded.split('\n');
  return lines.map((line, i) => {
    const parts = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      const token = m[0];
      if (token.startsWith('**')) {
        parts.push(<strong key={`${i}-${m.index}`}>{token.slice(2, -2)}</strong>);
      } else {
        parts.push(<code key={`${i}-${m.index}`}>{token.slice(1, -1)}</code>);
      }
      last = m.index + token.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <p key={i}>{parts.length ? parts : '\u00A0'}</p>;
  });
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4.5h4l1.2 1.5H13.5v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArtifacts() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="3.5" width="8" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 3.5V2.8a1 1 0 0 1 1-1H12a1.5 1.5 0 0 1 1.5 1.5V11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 4.5h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.6" fill="currentColor" />
      <circle cx="10" cy="11.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.5 4.5 5.2 8.8a2.2 2.2 0 0 0 3.1 3.1l5-5a3.4 3.4 0 0 0-4.8-4.8l-5.2 5.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="6" y="2.5" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconWave() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h1.2M5.5 5.5v5M8 3.5v9M10.5 5.5v5M13 8h1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5.2 12.8 2.5 13.5l.7-2.7L11.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5" y="5" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 11V3.5A1 1 0 0 1 4.5 2.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconThumb({ up }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={up ? undefined : { transform: 'rotate(180deg)' }}>
      <path
        d="M5 7V13H3.5A1.5 1.5 0 0 1 2 11.5v-3A1.5 1.5 0 0 1 3.5 7H5Zm0 0 1.8-4.2A1.4 1.4 0 0 1 8.1 2h.2A1.7 1.7 0 0 1 10 3.7V6h2.4a1.6 1.6 0 0 1 1.55 2l-.7 4A1.6 1.6 0 0 1 11.7 13H5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRetry() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13 8a5 5 0 1 1-1.3-3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13 3.5V7h-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 12.5V15M5 2.5h6l-1 4.5H12L8 11 4 7h2L5 2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3.5 6 8l4 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLeaf() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 13.5c0-5 3.5-8.5 6-10-1 5.5-3 8-6 10Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 13.5C8 8.5 4.5 5 2 3.5c1 5.5 3 8 6 10Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 13.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export default function ClaudeChat({ context, onBack }) {
  const { user, displayName, avatarLetter, isPro, signOut } = useAuth();
  const userId = user?.id;

  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [productTab, setProductTab] = useState('chat'); // chat | cowork | code
  const [sideView, setSideView] = useState('chats'); // chats | projects | artifacts | customize
  const [model, setModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState('');
  const [micStatus, setMicStatus] = useState('');
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const editRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputBaseRef = useRef('');
  const micStreamRef = useRef(null);
  const wantListenRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const useWhisperRef = useRef(false);
  const persistTimerRef = useRef(null);
  const knownChatIdsRef = useRef(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) setSideCollapsed(true);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      try {
        recognitionRef.current?.abort?.();
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
      try {
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      micStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  function getSpeechRecognition() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopMicStream() {
    try {
      micStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    micStreamRef.current = null;
  }

  function stopMic() {
    wantListenRef.current = false;
    useWhisperRef.current = false;
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null;
    stopMicStream();
    setListening(false);
    setMicStatus('');
  }

  function appendTranscript(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    setInput((prev) => {
      const next = `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${clean}`.trim();
      return next;
    });
    if (inputRef.current) {
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
      });
    }
  }

  function startBrowserSpeech() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return false;

    // Vabasta getUserMedia stream — SpeechRecognition kasutab oma mikrofoni
    stopMicStream();

    inputBaseRef.current = (typeof input === 'string' ? input : '').trim();
    const langs = ['et-EE', 'et', 'en-US'];
    let langIndex = 0;

    const startRecognition = () => {
      if (!wantListenRef.current) return;
      const recognition = new SpeechRecognition();
      recognition.lang = langs[langIndex] || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListening(true);
        setMicStatus('Kuulan… räägi. Klõpsa mikrofoni, et peatada.');
        setMicError('');
      };

      recognition.onerror = (e) => {
        const code = e?.error || '';
        if (code === 'language-not-supported' && langIndex < langs.length - 1) {
          langIndex += 1;
          return;
        }
        if (code === 'no-speech' && wantListenRef.current) return;
        if (code === 'aborted') return;

        wantListenRef.current = false;
        setListening(false);
        recognitionRef.current = null;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setMicError('Brauseri kõnetuvastus on blokeeritud. Proovi Chrome’is või Ava System Settings → Privacy → Speech Recognition.');
        } else if (code === 'network') {
          setMicError('Kõnetuvastus vajab internetti. Kontrolli võrku ja proovi uuesti.');
        } else {
          setMicError(`Kõnetuvastus ebaõnnestus (${code}).`);
        }
        setMicStatus('');
      };

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            inputBaseRef.current = `${inputBaseRef.current}${inputBaseRef.current ? ' ' : ''}${piece}`.trim();
          } else {
            interim += piece;
          }
        }
        const shown = `${inputBaseRef.current}${inputBaseRef.current && interim ? ' ' : ''}${interim}`.trim();
        setInput(shown);
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
          inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (wantListenRef.current) {
          try {
            startRecognition();
          } catch {
            stopMic();
          }
        } else {
          setListening(false);
          setMicStatus('');
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (err) {
        if (String(err?.message || err).includes('already started')) return;
        setMicError('Kõnetuvastust ei saanud käivitada. Proovi Chrome’is.');
        stopMic();
      }
    };

    wantListenRef.current = true;
    setListening(true);
    startRecognition();
    return true;
  }

  async function transcribeBlob(blob) {
    setMicStatus('Tuvastan kõnet…');
    const form = new FormData();
    const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    form.append('audio', blob, `speech.${ext}`);
    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'Tuvastus ebaõnnestus';
      if (/quota|billing|exceeded/i.test(msg)) {
        throw new Error(
          'OpenAI krediit on otsas (Whisper). Kasuta Chrome’i — seal töötab tasuta brauseri dikteerimine, või lisa billing: platform.openai.com/account/billing'
        );
      }
      throw new Error(msg);
    }
    return data.text || '';
  }

  async function startWhisperRecording(stream) {
    chunksRef.current = [];
    useWhisperRef.current = true;

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const wasWanted = useWhisperRef.current;
      useWhisperRef.current = false;
      setListening(false);
      const chunks = chunksRef.current;
      chunksRef.current = [];
      stopMicStream();
      mediaRecorderRef.current = null;

      if (!wasWanted || !chunks.length) {
        setMicStatus('');
        return;
      }

      try {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        if (blob.size < 800) {
          setMicError('Liiga lühike salvestus — hoia mikrofoni all ja räägi ~2 sek.');
          setMicStatus('');
          return;
        }
        const text = await transcribeBlob(blob);
        if (text) {
          appendTranscript(text);
          setMicError('');
          setMicStatus('');
        } else {
          setMicError('Kõnet ei tuvastatud — proovi uuesti.');
          setMicStatus('');
        }
      } catch (err) {
        // Whisper ebaõnnestus (nt quota) → proovi brauseri dikteerimist
        if (getSpeechRecognition()) {
          setMicError('');
          setMicStatus('OpenAI kvoodita — lülitan brauseri dikteerimisele. Klõpsa mikrofoni ja räägi.');
          wantListenRef.current = false;
          setTimeout(() => {
            setMicStatus('');
            toggleMic();
          }, 400);
          return;
        }
        setMicError(err.message || 'Tuvastus ebaõnnestus');
        setMicStatus('');
      }
    };

    recorder.start();
    setListening(true);
    setMicStatus('Kuulan… klõpsa mikrofoni uuesti, kui lõpetad.');
    setMicError('');
  }

  async function toggleMic() {
    if (listening || wantListenRef.current || mediaRecorderRef.current) {
      wantListenRef.current = false;
      if (mediaRecorderRef.current?.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          stopMic();
        }
        return;
      }
      stopMic();
      return;
    }

    setMicError('');
    setMicStatus('Käivitan mikrofoni…');

    // Eelistus: brauseri tasuta kõnetuvastus (Chrome) — ei vaja OpenAI krediiti
    if (getSpeechRecognition()) {
      // Küsi luba ette (et Allow oleks selge)
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setMicError(
            `Brauser blokeerib mikrofoni saidil ${origin}. Luba Microphone, Cmd+R, proovi uuesti.`
          );
        } else {
          setMicError('Mikrofoni ei saanud avada. Proovi Chrome’is http://localhost:3000');
        }
        setMicStatus('');
        return;
      }
      if (startBrowserSpeech()) return;
    }

    // Fallback: Whisper salvestus (vajab OpenAI krediiti)
    wantListenRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      await startWhisperRecording(stream);
    } catch (err) {
      wantListenRef.current = false;
      setMicStatus('');
      setMicError(err.message || 'Mikrofoni ei saanud kasutada.');
    }
  }

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setHydrated(false);

    async function hydrate() {
      const chatsKey = storageKey(userId, 'chats');
      const projectsKey = storageKey(userId, 'projects');

      // Server (RLS) is source of truth; local cache is per-user fallback only.
      let nextChats = [];
      let nextProjects = [];

      const { data: chatRows, error: chatErr } = await supabase
        .from('ai_chats')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (!cancelled && !chatErr && Array.isArray(chatRows) && chatRows.length) {
        nextChats = chatRows.map(rowToChat);
      } else {
        const cached = loadJson(chatsKey, []);
        if (Array.isArray(cached) && cached.length) nextChats = cached;
      }

      const { data: projectRows, error: projectErr } = await supabase
        .from('ai_projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!cancelled && !projectErr && Array.isArray(projectRows)) {
        nextProjects = projectRows.map((p) => ({ id: p.id, name: p.name }));
      } else {
        const cached = loadJson(projectsKey, []);
        if (Array.isArray(cached)) nextProjects = cached;
      }

      if (cancelled) return;

      if (!nextChats.length) {
        nextChats = [emptyChat()];
      }

      const sorted = [...nextChats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      knownChatIdsRef.current = new Set(sorted.map((c) => c.id));
      setChats(sorted);
      setActiveId(sorted[0].id);
      setProjects(nextProjects);
      saveJson(chatsKey, sorted);
      saveJson(projectsKey, nextProjects);
      setHydrated(true);
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const chatsKey = storageKey(userId, 'chats');
    saveJson(chatsKey, chats);

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      const rows = chats.map((c) => chatToRow(c, userId));
      const currentIds = new Set(chats.map((c) => c.id));
      const removed = [...knownChatIdsRef.current].filter((id) => !currentIds.has(id));

      if (rows.length) {
        await supabase.from('ai_chats').upsert(rows, { onConflict: 'id' });
      }
      if (removed.length) {
        await supabase.from('ai_chats').delete().eq('user_id', userId).in('id', removed);
      }
      knownChatIdsRef.current = currentIds;
    }, 450);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [chats, hydrated, userId]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const projectsKey = storageKey(userId, 'projects');
    saveJson(projectsKey, projects);

    const sync = async () => {
      const rows = projects.map((p) => ({
        id: p.id,
        user_id: userId,
        name: p.name,
      }));
      if (rows.length) {
        await supabase.from('ai_projects').upsert(rows, { onConflict: 'id' });
      }
    };
    sync();
  }, [projects, hydrated, userId]);

  function closeMobileSide() {
    if (isMobile) setSideCollapsed(true);
  }

  function openSide() {
    setSideCollapsed(false);
  }

  function toggleSide() {
    setSideCollapsed((v) => !v);
  }

  const active = useMemo(
    () => chats.find((c) => c.id === activeId) || chats[0] || null,
    [chats, activeId]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, busy]);

  const pinned = useMemo(
    () => [...chats].filter((c) => c.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [chats]
  );

  const recents = useMemo(
    () => [...chats].filter((c) => !c.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [chats]
  );

  function newChat() {
    const id = uid();
    const fresh = {
      id,
      title: 'Uus vestlus',
      messages: [],
      updatedAt: Date.now(),
      pinned: false,
    };
    setChats((prev) => [fresh, ...prev]);
    setActiveId(id);
    setInput('');
    setProductTab('chat');
    setSideView('chats');
    closeMobileSide();
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  function selectChat(id) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    setActiveId(id);
    setProductTab('chat');
    setSideView('chats');
    closeMobileSide();
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  function togglePin(id, e) {
    e.stopPropagation();
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  }

  function deleteChat(id, e) {
    e.stopPropagation();
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (!next.length) {
        const nid = uid();
        const fresh = [{ id: nid, title: 'Uus vestlus', messages: [], updatedAt: Date.now(), pinned: false }];
        setActiveId(nid);
        return fresh;
      }
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
  }

  function createProject() {
    const name = window.prompt('Projekti nimi');
    if (!name?.trim()) return;
    const project = { id: uid('p'), name: name.trim(), createdAt: Date.now() };
    setProjects((prev) => [project, ...prev]);
    setSideView('projects');
  }

  async function requestReply(withUser, { title } = {}) {
    if (!active || busy) return;
    const nextTitle =
      title ||
      (active.messages.length === 0 || withUser.length <= 1
        ? titleFromMessages(withUser)
        : active.title);

    setBusy(true);
    setChats((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? { ...c, messages: withUser, title: nextTitle, updatedAt: Date.now() }
          : c
      )
    );

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: withUser,
          prefs: { horizon: 'today', style: 'long', symbol: '', model },
          context: context || {},
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || 'Midagi läks valesti.';
      setChats((prev) =>
        prev
          .map((c) =>
            c.id === active.id
              ? { ...c, messages: [...withUser, { role: 'assistant', content: reply }], updatedAt: Date.now() }
              : c
          )
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      );
    } catch (err) {
      setChats((prev) =>
        prev.map((c) =>
          c.id === active.id
            ? { ...c, messages: [...withUser, { role: 'assistant', content: err.message }], updatedAt: Date.now() }
            : c
        )
      );
    }
    setBusy(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !active) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    await requestReply([...active.messages, { role: 'user', content: text }]);
  }

  function startEdit(index) {
    if (busy || !active) return;
    const msg = active.messages[index];
    if (!msg || msg.role !== 'user') return;
    setEditingIndex(index);
    setEditDraft(msg.content);
    setTimeout(() => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }, 30);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditDraft('');
  }

  async function saveEdit() {
    if (busy || editingIndex == null || !active) return;
    const text = editDraft.trim();
    if (!text) return;

    const truncated = active.messages.slice(0, editingIndex);
    const withUser = [...truncated, { role: 'user', content: text }];
    const isFirst = editingIndex === 0;

    setEditingIndex(null);
    setEditDraft('');
    await requestReply(withUser, {
      title: isFirst ? titleFromMessages(withUser) : active.title,
    });
  }

  async function retryLast() {
    if (busy || !active) return;
    const msgs = [...active.messages];
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const idx = msgs.lastIndexOf(lastUser);
    startEdit(idx);
  }

  function copyMsg(content) {
    navigator.clipboard?.writeText(content).catch(() => {});
  }

  if (!hydrated || !active) {
    return (
      <div className="claude-app">
        <div className="claude-loading">Laen vestlusi…</div>
      </div>
    );
  }

  function ChatRow({ c }) {
    return (
      <div className={`claude-recent ${c.id === active.id ? 'active' : ''}`}>
        <button type="button" className="claude-recent-main" onClick={() => selectChat(c.id)}>
          <span className="claude-recent-title">{c.title || 'Uus vestlus'}</span>
        </button>
        <span className="claude-recent-actions">
          <button
            type="button"
            className="claude-recent-act"
            onClick={(e) => togglePin(c.id, e)}
            title={c.pinned ? 'Eemalda pin' : 'Pin'}
          >
            <IconPin />
          </button>
          <button
            type="button"
            className="claude-recent-act"
            onClick={(e) => deleteChat(c.id, e)}
            title="Kustuta"
          >
            ×
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`claude-app ${sideCollapsed ? 'side-collapsed' : 'side-open'} ${isMobile ? 'is-mobile' : ''}`}
    >
      <header className="claude-topbar">
        <div className="claude-topbar-left">
          {(isMobile || sideCollapsed) && (
            <button
              type="button"
              className="claude-menu-btn"
              onClick={toggleSide}
              title={sideCollapsed ? 'Ava menüü' : 'Sulge menüü'}
              aria-label={sideCollapsed ? 'Ava menüü' : 'Sulge menüü'}
            >
              <IconMenu />
            </button>
          )}
          <div className="claude-brand">
            <span className="claude-brand-mark">Investor AI</span>
            <span className="claude-brand-sub">Research</span>
          </div>
          <nav className="claude-product-tabs">
            <button
              type="button"
              className={productTab === 'chat' ? 'active' : ''}
              onClick={() => {
                setProductTab('chat');
                setSideView('chats');
              }}
            >
              Vestlus
            </button>
            <button type="button" className={productTab === 'cowork' ? 'active' : ''} onClick={() => setProductTab('cowork')}>
              Tööruum
            </button>
            <button type="button" className={productTab === 'code' ? 'active' : ''} onClick={() => setProductTab('code')}>
              Tööriistad
            </button>
          </nav>
        </div>
        {onBack && (
          <button type="button" className="claude-top-back" onClick={onBack}>
            ← Markets
          </button>
        )}
      </header>

      <div className="claude-shell">
        {isMobile && !sideCollapsed && (
          <button type="button" className="claude-side-backdrop" aria-label="Sulge menüü" onClick={closeMobileSide} />
        )}

        {!sideCollapsed && (
          <aside className="claude-side">
            <button
              type="button"
              className="claude-new"
              onClick={newChat}
            >
              <IconPlus /> Uus vestlus
            </button>

            <nav className="claude-side-nav">
              <button
                type="button"
                className={sideView === 'projects' ? 'active' : ''}
                onClick={() => setSideView('projects')}
              >
                <IconFolder /> Kaustad
              </button>
              <button
                type="button"
                className={sideView === 'artifacts' ? 'active' : ''}
                onClick={() => setSideView('artifacts')}
              >
                <IconArtifacts /> Märkmed
              </button>
              <button
                type="button"
                className={sideView === 'customize' ? 'active' : ''}
                onClick={() => setSideView('customize')}
              >
                <IconSliders /> Seaded
              </button>
            </nav>

            <div className="claude-side-scroll">
              {sideView === 'chats' && (
                <>
                  {pinned.length > 0 && (
                    <>
                      <div className="claude-side-label">Kinnistatud</div>
                      <div className="claude-recents">
                        {pinned.map((c) => (
                          <ChatRow key={c.id} c={c} />
                        ))}
                      </div>
                    </>
                  )}
                  <div className="claude-side-label">Hiljutised</div>
                  <div className="claude-recents">
                    {recents.map((c) => (
                      <ChatRow key={c.id} c={c} />
                    ))}
                  </div>
                </>
              )}

              {sideView === 'projects' && (
                <div className="claude-panel-block">
                  <div className="claude-side-label">Kaustad</div>
                  <button type="button" className="claude-inline-btn" onClick={createProject}>
                    + Uus kaust
                  </button>
                  {projects.length === 0 && <p className="claude-side-empty">Pole veel kaustu.</p>}
                  {projects.map((p) => (
                    <div key={p.id} className="claude-project-row">
                      <IconFolder />
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {sideView === 'artifacts' && (
                <div className="claude-panel-block">
                  <div className="claude-side-label">Märkmed</div>
                  <p className="claude-side-empty">Siia tulevad salvestatud analüüsimärkmed.</p>
                </div>
              )}

              {sideView === 'customize' && (
                <div className="claude-panel-block">
                  <div className="claude-side-label">Seaded</div>
                  <p className="claude-side-empty">
                    Teemat ei pea ette valima — kirjuta nt „Analüüsi AMD”. AI arvutab P/E ja tippinvestorite filtrid.
                  </p>
                </div>
              )}
            </div>

            <div className="claude-side-foot">
              <div className="claude-update-card">
                <IconLeaf />
                <div>
                  <div className="claude-update-title">Sinu Investor AI</div>
                  <div className="claude-update-ver">Isiklikud vestlused</div>
                </div>
              </div>

              <div className="claude-profile">
                <div className="claude-avatar">{avatarLetter}</div>
                <div className="claude-profile-meta">
                  <span className="claude-profile-name">{displayName}</span>
                  {isPro && <span className="claude-pro">Pro</span>}
                </div>
                <div className="claude-profile-actions">
                  <button
                    type="button"
                    className="claude-icon-btn"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Menüü"
                  >
                    ⋯
                  </button>
                  {!isMobile && (
                    <button
                      type="button"
                      className="claude-icon-btn"
                      onClick={() => setSideCollapsed(true)}
                      title="Peida külgriba"
                    >
                      <IconCollapse />
                    </button>
                  )}
                </div>
                {menuOpen && (
                  <div className="claude-profile-menu">
                    {onBack && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onBack();
                        }}
                      >
                        ← Tagasi Marketsisse
                      </button>
                    )}
                    <button type="button" onClick={() => { setMenuOpen(false); setSideView('customize'); }}>
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setMenuOpen(false);
                        await signOut();
                      }}
                    >
                      Logi välja
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}

        {!isMobile && sideCollapsed && (
          <button type="button" className="claude-expand" onClick={openSide} title="Ava külgriba">
            ›
          </button>
        )}

        <main className="claude-main">
          {productTab === 'cowork' && (
            <div className="claude-mode-page">
              <h2>Tööruum</h2>
              <p>Hoia analüüside kaustu ja märkmeid Investor AI-s — eraldi vestlustest.</p>
              <button type="button" className="claude-inline-btn" onClick={() => setSideView('projects')}>
                Ava kaustad
              </button>
            </div>
          )}

          {productTab === 'code' && (
            <div className="claude-mode-page">
              <h2>Tööriistad</h2>
              <p>Küsi valuatsiooni, P/E/PEG arvutusi või portfelli loogikat. Ava Vestlus, et alustada.</p>
              <button type="button" className="claude-inline-btn" onClick={() => setProductTab('chat')}>
                Mine vestlusse
              </button>
            </div>
          )}

          {productTab === 'chat' && (
            <>
              <div className="claude-thread">
                {active.messages.length === 0 && !busy && (
                  <div className="claude-empty">
                    <div className="claude-asterisk" aria-hidden>
                      IA
                    </div>
                    <h2>Mis aktsiat analüüsime?</h2>
                    <p className="claude-empty-hint">Nt „Analüüsi AMD” — arvutan P/E, PEG ja õiglase hinna.</p>
                  </div>
                )}

                {active.messages.map((m, i) => (
                  <div key={i} className={`claude-msg ${m.role}`}>
                    {m.role === 'assistant' && (
                      <div className="claude-msg-icon" aria-hidden>
                        IA
                      </div>
                    )}
                    <div className="claude-msg-content">
                      {m.role === 'user' && editingIndex !== i && (
                        <div className="claude-msg-role">Sina</div>
                      )}

                      {m.role === 'user' && editingIndex === i ? (
                        <div className="claude-edit-box">
                          <textarea
                            ref={editRef}
                            value={editDraft}
                            rows={2}
                            onChange={(e) => {
                              setEditDraft(e.target.value);
                              const el = e.target;
                              el.style.height = 'auto';
                              el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                saveEdit();
                              }
                            }}
                          />
                          <div className="claude-edit-actions">
                            <button type="button" className="claude-edit-cancel" onClick={cancelEdit} disabled={busy}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="claude-edit-save"
                              onClick={saveEdit}
                              disabled={busy || !editDraft.trim()}
                            >
                              Save & submit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="claude-msg-body">{renderText(m.content)}</div>
                          {m.role === 'user' && (
                            <div className="claude-msg-actions">
                              <button type="button" title="Edit" onClick={() => startEdit(i)} disabled={busy}>
                                <IconEdit />
                              </button>
                              <button type="button" title="Copy" onClick={() => copyMsg(m.content)}>
                                <IconCopy />
                              </button>
                            </div>
                          )}
                          {m.role === 'assistant' && (
                            <div className="claude-msg-actions">
                              <button type="button" title="Copy" onClick={() => copyMsg(m.content)}>
                                <IconCopy />
                              </button>
                              <button type="button" title="Good">
                                <IconThumb up />
                              </button>
                              <button type="button" title="Bad">
                                <IconThumb />
                              </button>
                              <button type="button" title="Retry" onClick={retryLast} disabled={busy}>
                                <IconRetry />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {busy && (
                  <div className="claude-msg assistant">
                    <div className="claude-msg-icon claude-spin" aria-hidden>
                      IA
                    </div>
                    <div className="claude-msg-content">
                      <div className="claude-msg-body claude-thinking">Arvutan valuatsiooni…</div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <div className="claude-composer-wrap">
                <div className="claude-composer">
                  <div className="claude-composer-left">
                    <button type="button" className="claude-composer-icon" title="Lisa">
                      <IconPlus />
                    </button>
                    <button type="button" className="claude-composer-icon" title="Manus">
                      <IconPaperclip />
                    </button>
                  </div>
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    placeholder="Analüüsi AMD…"
                    onChange={(e) => {
                      setInput(e.target.value);
                      const el = e.target;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <div className="claude-composer-right">
                    <div className="claude-model-wrap">
                      <button
                        type="button"
                        className="claude-model"
                        onClick={() => setModelOpen((v) => !v)}
                      >
                        {model} ▾
                      </button>
                      {modelOpen && (
                        <div className="claude-model-menu">
                          {MODELS.map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={m === model ? 'active' : ''}
                              onClick={() => {
                                setModel(m);
                                setModelOpen(false);
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`claude-composer-icon ${listening ? 'listening' : ''}`}
                      title={listening ? 'Peata mikrofon' : 'Räägi (mikrofon)'}
                      onClick={toggleMic}
                      disabled={busy}
                    >
                      <IconMic />
                    </button>
                    <button
                      type="button"
                      className={`claude-send ${input.trim() ? 'ready' : ''} ${listening ? 'listening' : ''}`}
                      onClick={() => {
                        if (!input.trim() && !listening) {
                          toggleMic();
                          return;
                        }
                        if (listening) stopMic();
                        send();
                      }}
                      disabled={busy || (!input.trim() && listening)}
                      title={input.trim() ? 'Saada' : 'Räägi'}
                    >
                      {input.trim() ? '↑' : <IconWave />}
                    </button>
                  </div>
                </div>
                {micStatus && !micError && <div className="claude-mic-status">{micStatus}</div>}
                {micError && <div className="claude-mic-error">{micError}</div>}
                <div className="claude-disclaimer">Investor AI arvutab valuatsiooni; see ei ole isiklik soovitus. Kontrolli numbreid.</div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
