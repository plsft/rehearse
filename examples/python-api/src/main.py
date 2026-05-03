"""
Tiny FastAPI app for the GitGate python-api example.

Exposes one endpoint `POST /items` that writes a row to Postgres and
returns the row. The interesting bit is the CI pipeline that spins up
Postgres as a service container and runs integration tests against it.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/postgres")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(lifespan=lifespan)


class ItemIn(BaseModel):
    name: str


class ItemOut(BaseModel):
    id: int
    name: str


@app.get("/healthz")
def healthz() -> dict[str, str]:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/items", response_model=ItemOut)
def create_item(item: ItemIn) -> ItemOut:
    if not item.name.strip():
        raise HTTPException(status_code=400, detail="name cannot be empty")
    with SessionLocal() as session:
        row = Item(name=item.name)
        session.add(row)
        session.commit()
        session.refresh(row)
        return ItemOut(id=row.id, name=row.name)


@app.get("/items", response_model=list[ItemOut])
def list_items() -> list[ItemOut]:
    with SessionLocal() as session:
        return [ItemOut(id=r.id, name=r.name) for r in session.query(Item).all()]
