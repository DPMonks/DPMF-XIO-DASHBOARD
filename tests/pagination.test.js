import test from "node:test";
import assert from "node:assert/strict";
import {LIST_PAGE_SIZE, currentPage, pageCount, pageSlice, resetScrollTop, shouldFetchMoreRows} from "../src/utils/pagination.js";

test("pageCount is at least one and uses 100-row pages", () => {
  assert.equal(LIST_PAGE_SIZE, 100);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(100), 1);
  assert.equal(pageCount(101), 2);
  assert.equal(pageCount(103), 2);
  assert.equal(pageCount(700), 7);
});

test("pageSlice is the same for owner and LP lists", () => {
  const rows = Array.from({ length: 103 }, (_, i) => ({ rank: i + 1 }));
  const first = pageSlice(rows, 1);
  const second = pageSlice(rows, 2);
  const clamped = pageSlice(rows, 9);

  assert.equal(first.totalPages, 2);
  assert.equal(first.currentPage, 1);
  assert.equal(first.rows.length, 100);
  assert.equal(first.rows[0].rank, 1);

  assert.equal(second.currentPage, 2);
  assert.equal(second.rows.length, 3);
  assert.equal(second.rows[0].rank, 101);

  assert.equal(clamped.currentPage, 2);
  assert.equal(currentPage(0, 103), 1);
});

test("resetScrollTop returns a list scroller to the first row", () => {
  const node = { scrollTop: 480 };
  assert.equal(resetScrollTop(node), true);
  assert.equal(node.scrollTop, 0);
  assert.equal(resetScrollTop(null), false);
});

test("shouldFetchMoreRows keeps loading a full first page", () => {
  assert.equal(shouldFetchMoreRows(0, 100, 700), false);
  assert.equal(shouldFetchMoreRows(50, 100, 50), false);
  assert.equal(shouldFetchMoreRows(100, 100, 100), true);
  assert.equal(shouldFetchMoreRows(100, 100, 700), true);
  assert.equal(shouldFetchMoreRows(100, 100, null), true);
  assert.equal(shouldFetchMoreRows(40, 100, 235), true);
});
