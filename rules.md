# Repository Coding Rules

- RULE: Use Parameterized Queries
  Always use parameterized queries or prepared statements when executing database queries to prevent SQL Injection. Do not concatenate strings.

- RULE: Avoid production console.log
  Never leave console.log statements in production code. Use the centralized logger library (import { logger } from './shared/utils/logger') instead.

- RULE: Handled Async Code
  Ensure all asynchronous database queries or execution operations are correctly awaited or returned as Promises. Do not launch unhandled async actions.

- RULE: Avoid Insecure eval()
  Do not use eval() under any circumstances. It is insecure and blocks compile-time compiler optimization. Use structured parsers like JSON.parse.
