export const getLoggedInStaff = () => {
  const staff = localStorage.getItem("staff");
  return staff ? JSON.parse(staff) : null;
};
