"""https in the home network (tls.py, #145): the CA may only vouch for home-network addresses, keys stay private,
the server certificate is made anew when the address changes or it runs out."""
import datetime as dt
import ipaddress
import os
import stat

from cryptography import x509

import tls


def load(path):
    with open(path, "rb") as f:
        return x509.load_pem_x509_certificate(f.read())


def test_ca_name_constraints(tmp_path):
    folder = str(tmp_path / "tls")
    tls.ensure_ca(folder)
    p = tls.paths(folder)
    ca = load(p["ca"])
    nc = ca.extensions.get_extension_for_class(x509.NameConstraints)
    assert nc.critical
    permitted = nc.value.permitted_subtrees
    nets = {str(n.value) for n in permitted if isinstance(n, x509.IPAddress)}
    assert nets == set(tls.HOME_NETS)
    assert all(ipaddress.ip_network(n).is_private for n in nets)
    assert [n.value for n in permitted if isinstance(n, x509.DNSName)] == ["local"]
    bc = ca.extensions.get_extension_for_class(x509.BasicConstraints).value
    assert bc.ca and bc.path_length == 0
    assert stat.S_IMODE(os.stat(folder).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(p["ca_key"]).st_mode) == 0o600


def names(cert):
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    return {str(i) for i in san.get_values_for_type(x509.IPAddress)}, set(san.get_values_for_type(x509.DNSName))


def test_server_certificate(tmp_path):
    folder = str(tmp_path / "tls")
    cert_file, key_file = tls.ensure_server(folder, ["192.168.1.20", "", "192.168.1.20"], ["dream-mac.local", "public.example"])
    cert, ca = load(cert_file), load(tls.paths(folder)["ca"])
    assert names(cert) == ({"192.168.1.20"}, {"dream-mac.local"})     # no name outside .local
    assert cert.issuer == ca.subject
    cert.verify_directly_issued_by(ca)
    assert not cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    assert stat.S_IMODE(os.stat(key_file).st_mode) == 0o600
    assert cert.not_valid_after_utc - cert.not_valid_before_utc <= dt.timedelta(days=tls.LEAF_DAYS, minutes=5)


def test_same_address_keeps_the_certificate(tmp_path):
    folder = str(tmp_path / "tls")
    first = load(tls.ensure_server(folder, ["192.168.1.20"], ["dream-mac.local"])[0]).serial_number
    again = load(tls.ensure_server(folder, ["192.168.1.20"], ["DREAM-MAC.local"])[0]).serial_number
    assert first == again


def test_new_address_renews_the_certificate(tmp_path):
    folder = str(tmp_path / "tls")
    first = load(tls.ensure_server(folder, ["192.168.1.20"], [])[0])
    ca_before = load(tls.paths(folder)["ca"]).serial_number
    moved = load(tls.ensure_server(folder, ["10.0.0.7"], [])[0])
    assert moved.serial_number != first.serial_number
    assert names(moved)[0] == {"10.0.0.7"}
    assert load(tls.paths(folder)["ca"]).serial_number == ca_before      # the CA stays: devices keep trusting it


def test_running_out_renews(tmp_path, monkeypatch):
    folder = str(tmp_path / "tls")
    first = load(tls.ensure_server(folder, ["192.168.1.20"], [])[0])
    later = tls._now() + dt.timedelta(days=tls.LEAF_DAYS - tls.RENEW_DAYS + 1)
    monkeypatch.setattr(tls, "_now", lambda: later)
    renewed = load(tls.ensure_server(folder, ["192.168.1.20"], [])[0])
    assert renewed.serial_number != first.serial_number


def test_new_ca_drops_the_old_server_certificate(tmp_path):
    folder = str(tmp_path / "tls")
    tls.ensure_server(folder, ["192.168.1.20"], [])
    os.remove(tls.paths(folder)["ca_key"])
    tls.ensure_ca(folder)
    assert not os.path.exists(tls.paths(folder)["cert"])
    cert = load(tls.ensure_server(folder, ["192.168.1.20"], [])[0])
    cert.verify_directly_issued_by(load(tls.paths(folder)["ca"]))
