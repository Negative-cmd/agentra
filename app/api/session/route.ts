import { apiError, respond } from '@/lib/api';
import { currentUser } from '@/lib/auth';
export async function GET() {
  try { return respond({ user: await currentUser() }); } catch (error) { return apiError(error); }
}
