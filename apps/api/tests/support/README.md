# API Test Support

Shared test helpers create isolated temporary SQLite paths. Integration/property tasks must apply Foundation migrations before querying a test database and must invoke `cleanup()` in test teardown.
