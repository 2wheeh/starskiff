---
'starskiff': patch
---

Fixed Hermes setup commands blocking instance timeouts and surviving cleanup. Setup commands and retry delays now respond to cancellation, and teardown waits for child processes to exit.
