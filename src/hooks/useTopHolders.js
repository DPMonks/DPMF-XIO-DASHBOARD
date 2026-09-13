import {useEffect, useState} from "react";
import {getTopHolders} from "../api/indexer";

export default function useTopHolders() {
  const [data, setData] = useState([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getTopHolders((page) => {
          if (!cancelled) {
            setData(page);
            setCount(page.length);
          }
        });
        if (!cancelled) {
          setData(rows);
          setCount(rows.length);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, count, error };
}
