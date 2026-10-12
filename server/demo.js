// Demo mode (`npm run demo`): runs without Atlas or a Gemini key, using your local MongoDB.
// Login, signup, password reset and notes work. The tutor and quizzes need Atlas Vector Search + Gemini.
// Development only: it falls back to a fixed JWT secret.
import { Collection } from 'mongodb';
import { Models } from '@google/genai';

Collection.prototype.createSearchIndex = async () => 'vec'; // Atlas-only command
Models.prototype.embedContentInternal = async p =>           // placeholder vectors instead of calling Gemini
  ({ embeddings: [].concat(p.contents).map(() => ({ values: Array(768).fill(0.1) })) });

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017';
process.env.JWT_SECRET ||= 'demo-only-secret';
process.env.GEMINI_API_KEY ||= 'demo';
console.log(`DEMO MODE: database ${process.env.MONGODB_URI}, AI disabled`);
await import('./index.js');
