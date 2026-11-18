"""https in the home network (#145): Dream's own small certificate authority and the certificate of this Mac.

The authority (CA) is made once on this Mac; the owner installs its certificate once on every device of their own that
should use Dream Control over https. The CA may only vouch for addresses inside a home network (name constraints:
private IP ranges and *.local), so even if its key ever leaked it could not stand in for any website. Its key never
leaves ~/.local/state/dream/tls (mode 0600). The server certificate is made anew when the Mac's address changes and
before it runs out.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

HOME_NETS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8",
             "fc00::/7", "fe80::/10", "::1/128"]
CA_DAYS = 3650
LEAF_DAYS = 397          # what browsers accept for a server certificate
RENEW_DAYS = 30


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _write_private(path: str, data: bytes) -> None:
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as f:
        f.write(data)


def _key_pem(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def paths(folder: str) -> dict:
    return {k: os.path.join(folder, n) for k, n in
            (("ca_key", "ca-key.pem"), ("ca", "dream-ca.crt"), ("key", "server-key.pem"), ("cert", "server.crt"))}


def ensure_ca(folder: str):
    """The CA's key and certificate; made on first use."""
    os.makedirs(folder, mode=0o700, exist_ok=True)
    p = paths(folder)
    if os.path.exists(p["ca_key"]) and os.path.exists(p["ca"]):
        key = serialization.load_pem_private_key(open(p["ca_key"], "rb").read(), None)
        cert = x509.load_pem_x509_certificate(open(p["ca"], "rb").read())
        if cert.not_valid_after_utc - _now() > dt.timedelta(days=RENEW_DAYS):
            return key, cert
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Dream home network CA"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Dream")])
    permitted = [x509.IPAddress(ipaddress.ip_network(n)) for n in HOME_NETS] + [x509.DNSName("local")]
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(_now() - dt.timedelta(minutes=5)).not_valid_after(_now() + dt.timedelta(days=CA_DAYS))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                         crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.NameConstraints(permitted_subtrees=permitted, excluded_subtrees=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .sign(key, hashes.SHA256()))
    _write_private(p["ca_key"], _key_pem(key))
    with open(p["ca"], "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    for k in ("key", "cert"):                          # a new CA: the old server certificate no longer fits
        if os.path.exists(p[k]):
            os.remove(p[k])
    return key, cert


def _names(ips: list[str], hostnames: list[str]) -> set:
    return {*(f"ip:{i}" for i in ips), *(f"dns:{h.lower()}" for h in hostnames)}


def ensure_server(folder: str, ips: list[str], hostnames: list[str]) -> tuple[str, str]:
    """(certificate file, key file) for these addresses; made anew when they change or the certificate runs out."""
    ca_key, ca = ensure_ca(folder)
    p = paths(folder)
    ips = [i for i in dict.fromkeys(ips) if i]
    hostnames = [h for h in dict.fromkeys(hostnames) if h and h.lower().endswith(".local")]
    want = _names(ips, hostnames)
    if os.path.exists(p["cert"]) and os.path.exists(p["key"]):
        cert = x509.load_pem_x509_certificate(open(p["cert"], "rb").read())
        try:
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            have = _names([str(i) for i in san.get_values_for_type(x509.IPAddress)],
                          san.get_values_for_type(x509.DNSName))
        except x509.ExtensionNotFound:
            have = set()
        if (have == want and cert.issuer == ca.subject
                and cert.not_valid_after_utc - _now() > dt.timedelta(days=RENEW_DAYS)):
            return p["cert"], p["key"]
    key = ec.generate_private_key(ec.SECP256R1())
    alt = [x509.IPAddress(ipaddress.ip_address(i)) for i in ips] + [x509.DNSName(h) for h in hostnames]
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, (hostnames or ips or ["dream"])[0])]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(_now() - dt.timedelta(minutes=5)).not_valid_after(_now() + dt.timedelta(days=LEAF_DAYS))
            .add_extension(x509.SubjectAlternativeName(alt), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    _write_private(p["key"], _key_pem(key))
    with open(p["cert"], "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return p["cert"], p["key"]
