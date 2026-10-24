-- P341: the sandbox keychain option is gone; sandboxed agents always read the keychain.
DELETE FROM settings WHERE key = 'ade.sandboxKeychain';
