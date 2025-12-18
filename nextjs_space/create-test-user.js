const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  // Try reading from .env file
  const fs = require('fs');
  const envContent = fs.readFileSync('.env', 'utf8');
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1];
    }
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1];
    }
  }
}

async function createTestUser() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const testEmail = 'test-playwright@example.com';
  const testPassword = 'TestPassword123!';

  // Try to create user
  const { data, error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (error) {
    if (error.message.includes('already registered')) {
      console.log('Test user already exists');
      console.log(`EMAIL=${testEmail}`);
      console.log(`PASSWORD=${testPassword}`);
      return;
    }
    console.error('Error:', error.message);
    return;
  }

  console.log('Test user created successfully!');
  console.log(`EMAIL=${testEmail}`);
  console.log(`PASSWORD=${testPassword}`);
}

createTestUser();
