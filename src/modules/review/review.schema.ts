import { z } from 'zod';

export const CodeReviewSchema = z.object({
  hasCriticalVulnerability: z.boolean().describe("True if any CRITICAL issue exists."),
  summary: z.string().describe("Concise summary of overall code security and health."),
  score: z.number().min(0).max(100).describe("Overall quality score out of 100."),
  issues: z.array(
    z.object({
      filePath: z.string().optional().describe("The file path where the issue occurs."),
      severity: z.enum(['CRITICAL', 'WARNING', 'INFO']),
      line: z.number().optional().describe("Line number where defect occurs."),
      title: z.string().describe("Short descriptive title of the issue."),
      description: z.string().describe("Detailed explanation of defect or vulnerability."),
      suggestion: z.string().describe("Recommended code fix or refactored snippet."),
    })
  ),
});

export type CodeReviewResult = z.infer<typeof CodeReviewSchema>;

export const SYSTEM_PROMPT = `
You are a Principal Software Engineer and DevSecOps Specialist.
Analyze the provided code snippet specifically for:
1. Critical Logic Errors & Runtime Failures
2. OWASP Top 10 Vulnerabilities (SQLi, Secret Exposure, XSS, CSRF)
3. Performance Bottlenecks & Algorithmic Complexities (O(n^2))
4. Clean Code & Standard Practices

Classify issue severities strictly into CRITICAL, WARNING, or INFO. Be direct, concise, and actionable.
`;

export const AgentReviewSchema = z.object({
  issues: z.array(
    z.object({
      filePath: z.string().optional().describe("The file path where the issue occurs."),
      severity: z.enum(['CRITICAL', 'WARNING', 'INFO']),
      line: z.number().optional().describe("Line number where defect occurs."),
      title: z.string().describe("Short descriptive title of the issue."),
      description: z.string().describe("Detailed explanation of defect or vulnerability."),
      suggestion: z.string().describe("Recommended code fix or refactored snippet."),
    })
  ),
});

export type AgentReviewResult = z.infer<typeof AgentReviewSchema>;