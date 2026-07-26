import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY puudub — dikteerimine vajab OpenAI võtit (.env.local).' },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get('audio');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Helifail puudub' }, { status: 400 });
    }

    const forward = new FormData();
    forward.append('file', file, file.name || 'audio.webm');
    forward.append('model', 'whisper-1');
    forward.append('language', 'et');
    forward.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: forward,
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error?.message || 'Whisper ebaõnnestus' },
        { status: 500 }
      );
    }

    return NextResponse.json({ text: data.text || '' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
