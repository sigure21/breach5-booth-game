# Third-party notices

## Proxy Panic design lineage

The isolated adjudication engine is a new booth-oriented adaptation of the
raw request-target/canonical route trust-boundary model used in the MIT-licensed
`sigure21/ctf-proxy-panic` educational challenge. It does not contain or claim
to reproduce vulnerable Collabora or Nextcloud product code.

## qrcode

The `qrcode` npm package is distributed under the MIT license. See its package
metadata and installed license for the exact copyright notice.

## playwright-core

The UI verification tool uses `playwright-core`, distributed under the
Apache License 2.0. See its package metadata and installed `LICENSE` file for
the exact copyright and license text.

## Session Heist reference

The educational scenario design cites Simon Koeck's public write-up,
["Google DevSite Flask Session Pickle RCE"](https://simonkoeck.com/writeups/google-devsite-flask-session-pickle-rce).
The article is used as a factual
reference and is not copied into this repository. The `$90,000` label remains
an author-reported reward claim, not an independently verified payment or a CVE.

## Python runtime packages

The internal Session Heist engine installs the exact versions listed in
`engine/session-requirements.txt`: Flask 3.1.2 and Gunicorn 23.0.0. Their
transitive packages and license metadata are installed into the container by
`pip`; consult the corresponding upstream distributions for complete notices.
