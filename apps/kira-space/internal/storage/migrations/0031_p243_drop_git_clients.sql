-- P243 Part 2: the VS Code extension and its git.sock server are gone. Nothing reads git_clients
-- (paired-client token hashes) any more; its index drops with it.
DROP TABLE git_clients;
