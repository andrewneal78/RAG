/**
 * Diagnostic script to investigate failed file uploads
 */
import fs from 'fs';
import path from 'path';

const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || '/Users/aneal/Library/CloudStorage/OneDrive-UniversityofEdinburgh/national_security_analysis/gemini_PDF_processor/output/clean_final';

const failedFiles = [
    '183 Japan Defense of Japan 2021.txt',
    '341 St Kitts and Nevis National Security Strategy 2021.txt',
    '39 Belgium The Strategic Vision for Defence 2030 (2016).txt',
    '578 Japan Defence of Japan 2016.txt'
];

console.log('='.repeat(80));
console.log('DIAGNOSTIC REPORT: Failed File Upload Analysis');
console.log('='.repeat(80));
console.log(`\nDocuments Directory: ${DOCUMENTS_DIR}\n`);

// Get all files in directory for comparison
const allFiles = fs.readdirSync(DOCUMENTS_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.txt', '.pdf', '.doc', '.docx', '.md', '.html', '.json'].includes(ext);
});

// Calculate stats for all files
const allStats = allFiles.map(file => {
    const filePath = path.join(DOCUMENTS_DIR, file);
    const stats = fs.statSync(filePath);
    return {
        name: file,
        size: stats.size,
        path: filePath
    };
});

const avgSize = allStats.reduce((sum, f) => sum + f.size, 0) / allStats.length;
const maxSize = Math.max(...allStats.map(f => f.size));
const minSize = Math.min(...allStats.map(f => f.size));

console.log(`Total files in directory: ${allFiles.length}`);
console.log(`Average file size: ${(avgSize / 1024).toFixed(2)} KB`);
console.log(`Largest file: ${(maxSize / 1024).toFixed(2)} KB`);
console.log(`Smallest file: ${(minSize / 1024).toFixed(2)} KB`);
console.log('\n' + '='.repeat(80));

failedFiles.forEach((fileName, index) => {
    console.log(`\n[${index + 1}/${failedFiles.length}] Analyzing: ${fileName}`);
    console.log('-'.repeat(80));

    const filePath = path.join(DOCUMENTS_DIR, fileName);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.log('❌ FILE NOT FOUND');
        console.log(`   Expected path: ${filePath}`);
        return;
    }

    console.log('✓ File exists');

    // Get file stats
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`   Size: ${sizeKB} KB (${sizeMB} MB)`);
    console.log(`   Size comparison: ${((stats.size / avgSize) * 100).toFixed(1)}% of average`);

    if (stats.size > avgSize * 2) {
        console.log('   ⚠️  WARNING: File is unusually large (>2x average)');
    }
    if (stats.size > 10 * 1024 * 1024) {
        console.log('   ⚠️  WARNING: File exceeds 10MB');
    }

    // Check file permissions
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        console.log('✓ File is readable');
    } catch (err) {
        console.log('❌ File is NOT readable');
        console.log(`   Error: ${err.message}`);
        return;
    }

    // Try to read file
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        console.log(`✓ File content readable`);
        console.log(`   Characters: ${content.length}`);
        console.log(`   Lines: ${content.split('\n').length}`);

        // Check for potential issues
        const hasNullBytes = content.includes('\0');
        const hasInvalidUTF8 = /[\uFFFD]/.test(content);

        if (hasNullBytes) {
            console.log('   ⚠️  WARNING: Contains null bytes (may indicate binary content)');
        }
        if (hasInvalidUTF8) {
            console.log('   ⚠️  WARNING: Contains invalid UTF-8 characters');
        }

        // Show first 200 characters
        console.log(`   Preview: ${content.substring(0, 200).replace(/\n/g, ' ')}...`);

    } catch (err) {
        console.log('❌ Error reading file content');
        console.log(`   Error: ${err.message}`);

        // Try reading as binary
        try {
            const buffer = fs.readFileSync(filePath);
            console.log(`   File appears to be binary (${buffer.length} bytes)`);
        } catch (binErr) {
            console.log(`   Cannot read as binary either: ${binErr.message}`);
        }
    }

    // Check filename for special characters
    const hasSpecialChars = /[^\w\s\-\.\(\)]/.test(fileName);
    if (hasSpecialChars) {
        console.log('   ⚠️  WARNING: Filename contains special characters');
    }

    // Compare with successfully uploaded similar files
    const similarFiles = allStats.filter(f =>
        f.name.includes(fileName.split(' ')[0]) ||
        fileName.includes(f.name.split(' ')[0])
    ).filter(f => f.name !== fileName);

    if (similarFiles.length > 0) {
        console.log(`\n   Similar files that MAY have uploaded successfully:`);
        similarFiles.slice(0, 3).forEach(f => {
            console.log(`      - ${f.name} (${(f.size / 1024).toFixed(2)} KB)`);
        });
    }
});

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`\nDiagnostic complete. Check above for warnings and issues.`);
console.log(`\nRecommended next steps:`);
console.log(`1. If files are too large, consider splitting them`);
console.log(`2. If files have encoding issues, try converting to UTF-8`);
console.log(`3. If files are readable, the issue may be network/API related`);
console.log(`4. Try the retry-failed-files.js script with extended settings\n`);
