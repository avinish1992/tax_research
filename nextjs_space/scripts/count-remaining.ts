import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const {count: done} = await s.from('document_chunks').select('*', {count: 'exact', head: true}).not('embedding_local', 'is', null);
  const {count: remaining} = await s.from('document_chunks').select('*', {count: 'exact', head: true}).is('embedding_local', null);
  console.log(`Done: ${done} | Remaining: ${remaining} | Percent: ${((done!/(done!+remaining!))*100).toFixed(1)}%`);
}

main();
