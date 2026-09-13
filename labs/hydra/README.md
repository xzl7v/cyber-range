# Hydra SSH Training Lab

This directory contains the intentionally vulnerable SSH target image and password list used by the runtime manager. The runtime manager builds the `ssh-target` stage on demand when a student starts the seeded Hydra lab.

The target:

- listens on port 22
- has a training-only user `trainee`
- has the intentionally weak training password `Lab12345`
- allows password authentication only for `trainee`
- disables root login, forwarding, and tunneling
- has no host port binding

Students perform the Hydra step inside their isolated Kali desktop. The training target is reachable from that Kali session as `target`.
