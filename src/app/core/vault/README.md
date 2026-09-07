# Vault service

The only stateful piece. Holds the unlocked vault and the derived key for the
duration of a session. Owns lock/unlock lifecycle, idle timeout, and the save/sync
cycle. Discards key material on lock.
