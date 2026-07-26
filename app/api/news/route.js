import { NextResponse } from 'next/server';
import { getNewsByTopic, NEWS_TOPICS } from '../../../lib/newsRss';
import { cached } from '../../../lib/cache';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const topic = searchParams.get('topic') || 'top';
  const valid = NEWS_TOPICS.some((t) => t.id === topic) ? topic : 'top';

  try {
    const data = await cached(`hot-news-topic:${valid}`, 8 * 60 * 1000, () => getNewsByTopic(valid));
    return NextResponse.json({
      ...data,
      topics: NEWS_TOPICS.map(({ id, label }) => ({ id, label })),
    });
  } catch (err) {
    return NextResponse.json({
      items: [],
      topic: valid,
      topics: NEWS_TOPICS.map(({ id, label }) => ({ id, label })),
      error: err.message,
    });
  }
}
