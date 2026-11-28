import {createHash} from 'node:crypto';
import {currentJob} from './job-scheduler.mjs';

// Keep this filesystem-free: Next server routes use it to label renderer requests.
export function renderSecurityHeaders(explicit){
 const job=explicit??currentJob();
 return job?{'x-fw-owner':job.owner?'1':'0','x-fw-job-key':createHash('sha256').update(job.key??job.userId).digest('hex')}:{};
}
