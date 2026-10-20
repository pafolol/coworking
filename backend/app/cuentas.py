"""Cuentas locales: contraseñas con PBKDF2 y las cuentas iniciales (admin, admin2)."""
import hashlib
import hmac
import os
import secrets

from sqlalchemy.orm import Session

from .models import User

ITERACIONES = 390_000
CUENTAS_INICIALES = [("admin", "Administrador"), ("admin2", "Administrador 2")]


def hash_password(password: str) -> str:
    sal = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(sal), ITERACIONES).hex()
    return f"pbkdf2_sha256${ITERACIONES}${sal}${digest}"


def check_password(password: str, guardado: str) -> bool:
    try:
        _, iteraciones, sal, digest = guardado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(sal), int(iteraciones)).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calc, digest)


def ensure_users(db: Session) -> None:
    """Crea admin y admin2 con LOGIN_PASSWORD (backend/.env) si aún no existen."""
    password = os.environ.get("LOGIN_PASSWORD", "")
    if not password:
        return
    for usuario, nombre in CUENTAS_INICIALES:
        if db.get(User, usuario) is None:
            db.add(User(usuario=usuario, nombre=nombre, password_hash=hash_password(password)))
    db.commit()
