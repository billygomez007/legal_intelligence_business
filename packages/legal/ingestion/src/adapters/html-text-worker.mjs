// Worker-thread entry: extract text from one HTML document and report the result. Its caller
// enforces a deadline and a memory ceiling by terminating this thread; nothing here has side
// effects beyond the message it posts.
import { parentPort, workerData } from 'node:worker_threads';

import { htmlText } from './html-text.mjs';

if (parentPort === null) throw new Error('html-text-worker must run in a worker thread');
parentPort.postMessage(htmlText(String(workerData.input)));
