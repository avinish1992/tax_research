/**
 * Batch Document Upload Script
 *
 * Uploads multiple PDF documents and indexes them with PageIndex
 * Run with: npx ts-node --skip-project scripts/batch-upload.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Documents directory
const DOCS_DIR = path.join(__dirname, '../../documents');

// User ID to assign documents to (you'll need to get this from Supabase)
const TARGET_USER_ID = process.env.TARGET_USER_ID;

async function getDocumentsToUpload(): Promise<string[]> {
  const files = fs.readdirSync(DOCS_DIR);
  const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

  // Get already uploaded documents
  const { data: existingDocs } = await supabase
    .from('documents')
    .select('file_name')
    .eq('user_id', TARGET_USER_ID);

  const uploadedNames = new Set(existingDocs?.map(d => d.file_name) || []);

  // Filter out already uploaded
  const toUpload = pdfs.filter(f => !uploadedNames.has(f));

  return toUpload;
}

async function uploadDocument(fileName: string): Promise<boolean> {
  const filePath = path.join(DOCS_DIR, fileName);

  try {
    console.log(`\n📄 Processing: ${fileName}`);

    const buffer = fs.readFileSync(filePath);
    const fileSize = buffer.length;

    // Upload to Supabase Storage
    const storagePath = `${TARGET_USER_ID}/${Date.now()}-${fileName}`;
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf'
      });

    if (storageError) {
      console.error(`   ❌ Storage upload failed: ${storageError.message}`);
      return false;
    }

    console.log(`   ✅ Uploaded to storage`);

    // Create document record
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: TARGET_USER_ID,
        file_name: fileName,
        original_name: fileName,
        file_size: fileSize,
        storage_path: storagePath,
        mime_type: 'application/pdf',
        status: 'pending_tree_indexing',
        chunk_count: 0,
        total_chunks: 0,
      })
      .select()
      .single();

    if (docError || !doc) {
      console.error(`   ❌ Document record failed: ${docError?.message}`);
      return false;
    }

    console.log(`   ✅ Document record created: ${doc.id}`);

    // NOTE: Tree indexing will be done by a separate background process
    // This script just uploads and creates records

    return true;
  } catch (err: any) {
    console.error(`   ❌ Error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Batch Document Upload ===\n');

  if (!TARGET_USER_ID) {
    console.error('TARGET_USER_ID environment variable not set');
    console.log('\nTo get your user ID:');
    console.log('1. Log into the app');
    console.log('2. Run in Supabase SQL: SELECT id, email FROM auth.users;');
    console.log('3. Set TARGET_USER_ID in .env.local');
    process.exit(1);
  }

  const toUpload = await getDocumentsToUpload();

  console.log(`Documents directory: ${DOCS_DIR}`);
  console.log(`Documents to upload: ${toUpload.length}`);
  console.log(`Target user: ${TARGET_USER_ID}\n`);

  if (toUpload.length === 0) {
    console.log('All documents already uploaded!');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const fileName of toUpload) {
    const result = await uploadDocument(fileName);
    if (result) success++;
    else failed++;
  }

  console.log('\n=== Summary ===');
  console.log(`✅ Uploaded: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${toUpload.length}`);
}

main().catch(console.error);
