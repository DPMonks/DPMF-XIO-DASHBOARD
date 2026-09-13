import BrandSelect from "../BrandSelect";

export default function PoolSelector({ value, options, onChange, ariaLabel }) {
  return (
    <label className="governance-select">
      <BrandSelect
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        searchable
        placeholder={ariaLabel}
      />
    </label>
  );
}
