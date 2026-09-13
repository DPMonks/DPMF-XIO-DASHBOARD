import {useEffect, useState} from "react";
import {api} from "../api";

export default function usePools() {
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    api
      .pools()
      .then((pools) => {
        if (!cancelled) {
          setData(Array.isArray(pools) ? pools : []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error };
}
